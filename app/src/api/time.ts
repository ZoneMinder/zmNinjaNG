/**
 * Time API
 * 
 * Handles fetching server time configuration.
 */

import { getApiClient } from './client';
import { HostTimeZoneResponseSchema } from './types';

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
        if (error && typeof error === 'object' && 'response' in error) {
            // Log API error details if available
            console.error('getServerTimeZone API Error:', (error as any).response?.data);
        } else {
            // Log validation or other errors
            console.error('getServerTimeZone Validation Error:', error);
            // HACK: Use 'any' cast to try to inspect data if it exists on error object or closure is unavailable
            // In a real scenario we'd want to access response.data but it's out of scope here unless we restructure.
        }
        throw error;
    }
}
