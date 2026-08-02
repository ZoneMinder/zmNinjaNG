/**
 * States API
 *
 * Handles fetching and changing ZoneMinder system states.
 */

import type { ApiClient } from './client';
import type { State } from './types';
import { StatesResponseSchema } from './types';
import { validateApiResponse } from '../lib/zm/api-validator';
import { log, LogLevel } from '../lib/logger';

/**
 * Get all states
 *
 * @param client - API client for the target profile
 * @returns Promise resolving to array of State objects
 */
export async function getStates(client: ApiClient): Promise<State[]> {
  const response = await client.get('/states.json', { intent: 'Fetch system states' });

  // Validate response with Zod
  const validated = validateApiResponse(StatesResponseSchema, response.data, {
    endpoint: '/states.json',
    method: 'GET',
  });

  const stateDataArray = validated.states || [];

  // Transform StateData objects to State objects (unwrap and convert types)
  return stateDataArray.map((stateData) => ({
    Id: String(stateData.State.Id),
    Name: stateData.State.Name,
    Definition: stateData.State.Definition,
    IsActive: String(stateData.State.IsActive),
  }));
}

/**
 * Change state
 *
 * @param client - API client for the target profile
 * @param stateName - The name of the state to activate
 */
export async function changeState(client: ApiClient, stateName: string): Promise<void> {
  log.api('Changing system state', LogLevel.INFO, { stateName });

  await client.post(`/states/change/${stateName}.json`);
}
