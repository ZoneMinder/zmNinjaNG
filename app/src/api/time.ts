/**
 * Time API
 *
 * Handles fetching server time configuration.
 */

import { getApiClient } from './client';
import { HostTimeZoneResponseSchema } from './types';
import { log, LogLevel } from '../lib/logger';
import type { HttpError } from '../lib/http';

/**
 * Get server time zone.
 * 
 * @param token - Optional auth token to use for the request (overrides store)
 * @returns Promise resolving to time zone string (e.g., "America/New_York")
 */
export async function getServerTimeZone(token?: string): Promise<string> {
    const client = getApiClient();
    try {
        const config = token ? { params: { token } } : {};
        const response = await client.get<unknown>('/host/getTimeZone.json', config);
        const validated = HostTimeZoneResponseSchema.parse(response.data);
        return validated.DateTime.TimeZone;
    } catch (error) {
        const httpError = error as HttpError;
        if (httpError && typeof httpError === 'object' && 'status' in httpError) {
            log.api('getServerTimeZone API Error', LogLevel.ERROR, {
                responseData: httpError.data,
                error,
            });
        } else {
            log.api('getServerTimeZone Validation Error', LogLevel.ERROR, error);
        }
        throw error;
    }
}
