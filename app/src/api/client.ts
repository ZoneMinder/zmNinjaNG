import { httpRequest, type HttpError, type HttpOptions, type HttpResponse } from '../lib/http';
import { API_REQUEST } from '../lib/zmninja-ng-constants';
import { log, LogLevel } from '../lib/logger';
import { sanitizeObject } from '../lib/log-sanitizer';
import { setApiClientInitialized } from './client-ready';

export type ApiMethod = NonNullable<HttpOptions['method']>;

export interface ApiRequestConfig {
  baseURL?: string;
  headers?: Record<string, string>;
  params?: Record<string, string | number>;
  responseType?: HttpOptions['responseType'];
  timeout?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  validateStatus?: (status: number) => boolean;
  onDownloadProgress?: HttpOptions['onDownloadProgress'];
  /**
   * Domain-level label rendered in the HTTP log headline, e.g.
   * "Fetch monitors list". Replaces the redundant log.api intent
   * line at the call site.
   */
  intent?: string;
  /**
   * HTTP statuses the caller handles itself and does not consider errors, e.g.
   * a 404 from a feature-probe endpoint. The request still rejects so the
   * caller can branch on it, but the client logs at DEBUG instead of ERROR so
   * expected non-2xx responses do not show up as errors.
   */
  expectedStatuses?: number[];
}

export interface ApiClient {
  get<T = unknown>(url: string, config?: ApiRequestConfig): Promise<HttpResponse<T>>;
  post<T = unknown>(url: string, data?: unknown, config?: ApiRequestConfig): Promise<HttpResponse<T>>;
  put<T = unknown>(url: string, data?: unknown, config?: ApiRequestConfig): Promise<HttpResponse<T>>;
  delete<T = unknown>(url: string, config?: ApiRequestConfig): Promise<HttpResponse<T>>;
}

/**
 * Auth operations the client needs, injected instead of importing the auth
 * store. All single-flight deduplication (proactive login, token refresh,
 * 401 recovery) lives behind this gate in stores/auth.ts. Refs #184.
 */
export interface AuthGate {
  getAccessToken(): string | null;
  getAccessTokenExpires(): number | null;
  isAuthenticated(): boolean;
  /** Deduped refresh-or-relogin; resolves to a usable token or null. */
  getFreshAccessToken(): Promise<string | null>;
  /** Deduped login used by the proactive auth path. */
  proactiveLogin(reLogin: () => Promise<boolean>): Promise<boolean>;
  /**
   * Single-flight 401 recovery: refresh, fall back to reLogin, logout once on
   * total failure. Resolves true when the session is valid again. Never rejects.
   */
  recoverFromAuthFailure(reLogin?: () => Promise<boolean>): Promise<boolean>;
}

/** Settings the client needs, injected instead of importing the settings store. */
export interface SettingsGate {
  /** Per-request timeout for the profile, in seconds. 0 disables it. */
  getApiTimeoutSeconds(profileId: string): number;
}

export interface ApiClientGates {
  auth: AuthGate;
  settings: SettingsGate;
}

let apiClient: ApiClient | null = null;

// Correlation ID counter - starts at 1, increments with each request, resets on app restart
let correlationIdCounter = 0;

function resolveUrl(baseURL: string, url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  const trimmedBase = baseURL.replace(/\/$/, '');
  const normalizedPath = url.startsWith('/') ? url : `/${url}`;
  return `${trimmedBase}${normalizedPath}`;
}

function appendQuery(url: string, params: Record<string, string | number>): string {
  const stringParams: Record<string, string> = {};
  Object.entries(params).forEach(([key, value]) => {
    stringParams[key] = String(value);
  });
  const queryParams = new URLSearchParams(stringParams).toString();
  if (!queryParams) return url;
  return url.includes('?') ? `${url}&${queryParams}` : `${url}?${queryParams}`;
}

export function createApiClient(
  baseURL: string,
  gates: ApiClientGates,
  reLogin?: () => Promise<boolean>,
  profileId?: string,
): ApiClient {
  // Resolve the default per-request timeout (ms) from the profile setting, used
  // when the caller didn't set one. 0 (or unset) disables it. Read at call time
  // so changes take effect without recreating the client.
  const resolveDefaultTimeoutMs = (config: ApiRequestConfig): number | undefined => {
    if (config.timeoutMs !== undefined || config.timeout !== undefined) return undefined;
    const isDownload =
      !!config.onDownloadProgress ||
      config.responseType === 'blob' ||
      config.responseType === 'arraybuffer' ||
      config.responseType === 'base64';
    if (isDownload) return undefined;
    const secs = profileId
      ? gates.settings.getApiTimeoutSeconds(profileId)
      : API_REQUEST.defaultTimeoutSeconds;
    return secs && secs > 0 ? secs * 1000 : undefined;
  };
  const request = async <T>(
    method: ApiMethod,
    url: string,
    data?: unknown,
    config: ApiRequestConfig = {},
    hasRetried = false
  ): Promise<HttpResponse<T>> => {
    const correlationId = ++correlationIdCounter;
    const accessToken = gates.auth.getAccessToken();
    const headers = { ...(config.headers ?? {}) };
    const params: Record<string, string | number> = { ...(config.params ?? {}) };

    const skipAuth = headers['Skip-Auth'] === 'true';
    const isLoginRequest = url.includes('login.json') && method.toUpperCase() === 'POST';

    // PROACTIVE: If not authenticated and not a login request, trigger login first
    if (!gates.auth.isAuthenticated() && !skipAuth && !isLoginRequest && reLogin && !hasRetried) {
      log.api(`Request requires authentication, triggering login first`, LogLevel.DEBUG, {
        correlationId,
        method,
        url,
      });

      let loginSuccess = false;
      try {
        // Single-flight in the auth store: concurrent requests share one reLogin.
        loginSuccess = await gates.auth.proactiveLogin(reLogin);
      } catch (error) {
        log.api('Proactive login failed', LogLevel.ERROR, error);
        throw error;
      }

      // Check if login actually succeeded before retrying
      if (!loginSuccess) {
        throw new Error('Authentication required but login failed');
      }

      // Retry the original request now that we're authenticated
      return request(method, url, data, config, true);
    }

    if (accessToken && !skipAuth && !isLoginRequest) {
      const accessTokenExpires = gates.auth.getAccessTokenExpires();
      const isAccessTokenExpired = accessTokenExpires !== null && accessTokenExpires <= Date.now();
      if (isAccessTokenExpired) {
        log.api(
          `Access token expired by ${Date.now() - (accessTokenExpires ?? 0)}ms; refreshing before attach`,
          LogLevel.DEBUG,
          { correlationId, method, url },
        );
        const fresh = await gates.auth.getFreshAccessToken();
        if (fresh) {
          params.token = fresh;
        }
      } else {
        params.token = accessToken;
      }
    }

    const resolvedBaseUrl = config.baseURL ?? baseURL;
    // The session token is meant for the configured server. Warn if a per-request
    // baseURL override (e.g. a server-controlled Servers map host) points the
    // token at a different host.
    if (params.token && config.baseURL && config.baseURL !== baseURL) {
      try {
        const targetHost = new URL(resolvedBaseUrl).hostname;
        const configuredHost = new URL(baseURL).hostname;
        if (targetHost !== configuredHost) {
          log.api(
            'Attaching session token to a server host that differs from the configured portal',
            LogLevel.WARN,
            { targetHost, configuredHost, correlationId, method },
          );
        }
      } catch {
        // baseURL not parseable; skip the cross-host check.
      }
    }
    const fullUrl = resolveUrl(resolvedBaseUrl, url);
    const fullUrlWithParams = appendQuery(fullUrl, params);

    try {
      const response = await httpRequest<T>(fullUrl, {
        method,
        headers,
        params,
        body: data,
        responseType: config.responseType,
        timeout: config.timeout,
        timeoutMs: config.timeoutMs ?? resolveDefaultTimeoutMs(config),
        validateStatus: config.validateStatus,
        signal: config.signal,
        onDownloadProgress: config.onDownloadProgress,
        correlationId,
        intent: config.intent,
      });

      return response;
    } catch (error) {
      const httpError = error as HttpError;
      if (httpError.status === 401 && !hasRetried && !skipAuth && !isLoginRequest) {
        const recovered = await gates.auth.recoverFromAuthFailure(reLogin);
        if (recovered) {
          return request(method, url, data, config, true);
        }
        // Recovery failed (logout already ran inside the shared recovery).
        // Fall through to log and propagate the original 401.
      }

      const errorData: Record<string, unknown> = {
        correlationId,
        method,
        url: fullUrlWithParams,
        zmUrl: fullUrl,
        status: httpError.status,
        statusText: httpError.statusText,
        message: httpError.message,
      };

      if (httpError.data) {
        errorData.responseData = sanitizeObject(httpError.data);
      }

      if (data) {
        if (data instanceof URLSearchParams) {
          const formDataObj: Record<string, string> = {};
          data.forEach((value: string, key: string) => {
            formDataObj[key] = value;
          });
          errorData.requestFormData = sanitizeObject(formDataObj);
        } else {
          errorData.requestBodyData = sanitizeObject(data);
        }
      }

      // Statuses the caller declared as expected (e.g. a 404 feature probe) are
      // logged at DEBUG so they don't surface as errors. The request still
      // rejects so the caller can branch on the status.
      const isExpectedStatus =
        httpError.status !== undefined &&
        (config.expectedStatuses?.includes(httpError.status) ?? false);

      log.api(
        `[Error #${correlationId}] ${method} ${fullUrlWithParams}`,
        isExpectedStatus ? LogLevel.DEBUG : LogLevel.ERROR,
        { error, ...errorData },
      );

      throw error;
    }
  };

  return {
    get: <T>(url: string, config?: ApiRequestConfig) => request<T>('GET', url, undefined, config),
    post: <T>(url: string, data?: unknown, config?: ApiRequestConfig) => request<T>('POST', url, data, config),
    put: <T>(url: string, data?: unknown, config?: ApiRequestConfig) => request<T>('PUT', url, data, config),
    delete: <T>(url: string, config?: ApiRequestConfig) => request<T>('DELETE', url, undefined, config),
  };
}

export function getApiClient(): ApiClient {
  if (!apiClient) {
    throw new Error('API client not initialized. Call createApiClient first.');
  }
  return apiClient;
}

export function setApiClient(client: ApiClient): void {
  apiClient = client;
  setApiClientInitialized(true);
}

/**
 * Hooks run by resetApiClient. api/store-gates.ts registers the auth store's
 * resetAuthGates here so a profile switch clears the pending single-flight
 * gates without the client importing the store.
 */
const resetHooks = new Set<() => void>();

export function registerApiClientResetHook(hook: () => void): void {
  resetHooks.add(hook);
}

export function resetApiClient(): void {
  apiClient = null;
  // A profile switch must not await a login/refresh/recovery started for the
  // old profile.
  resetHooks.forEach((hook) => hook());
  setApiClientInitialized(false);
}
