/**
 * Groups API
 *
 * Handles fetching monitor groups from ZoneMinder.
 * Groups are hierarchical (parent/child) and monitors can belong to multiple groups.
 */

import type { ApiClient } from './client';
import type { GroupsResponse } from './types';
import { GroupsResponseSchema } from './types';
import { validateApiResponse } from '../lib/zm/api-validator';

/**
 * Get all monitor groups.
 *
 * Fetches the list of all groups from /groups.json.
 * Each group contains its metadata and an array of monitor references.
 *
 * @param client - API client for the target profile
 * @returns Promise resolving to GroupsResponse containing array of groups
 */
export async function getGroups(client: ApiClient): Promise<GroupsResponse> {
  const response = await client.get<GroupsResponse>('/groups.json', {
    intent: 'Fetch groups list',
  });

  // Validate response with Zod
  return validateApiResponse(GroupsResponseSchema, response.data, {
    endpoint: '/groups.json',
    method: 'GET',
  });
}
