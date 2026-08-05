/**
 * Separating a permission refusal from an expired session.
 *
 * ZoneMinder answers both with HTTP 401 and distinguishes them only in the
 * body: `Insufficient Privileges` when the account may not do the thing,
 * `Not Authenticated` when the token is missing or stale. The client retries
 * 401s through a token refresh, which is right for the second and useless for
 * the first - a refusal survives any number of fresh tokens, so the retry only
 * spends requests before failing with a message about the server rather than
 * about the account.
 *
 * The match is deliberately narrow. Anything that is not an explicit privilege
 * refusal keeps the old recovery path, because misreading a stale session as a
 * permission problem would strand a user who only needed a new token.
 */

/** Body ZoneMinder serializes for an `UnauthorizedException`. */
interface ZmErrorBody {
  data?: {
    name?: unknown;
    message?: unknown;
    exception?: { message?: unknown };
  };
}

const PRIVILEGE_REFUSAL = /insufficient privileges?/i;

/**
 * Whether this error is ZoneMinder refusing on permissions rather than on
 * authentication. False for everything it cannot positively identify.
 */
export function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ((error as { status?: number }).status !== 401) return false;

  const body = (error as { data?: unknown }).data as ZmErrorBody | undefined;
  const payload = body && typeof body === 'object' ? body.data : undefined;
  if (!payload || typeof payload !== 'object') return false;

  return [payload.name, payload.message, payload.exception?.message].some(
    (value) => typeof value === 'string' && PRIVILEGE_REFUSAL.test(value),
  );
}
