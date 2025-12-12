import { getApiClient } from './client';

export interface State {
  Id: string;
  Name: string;
  Definition: string;
  IsActive: string;
}

interface StateWrapper {
  State: {
    Id: number;
    Name: string;
    Definition: string;
    IsActive: number;
  };
}

/**
 * Get all states
 */
export async function getStates(): Promise<State[]> {
  const client = getApiClient();
  const response = await client.get('/states.json');
  const stateWrappers: StateWrapper[] = response.data.states || [];

  // Unwrap the State objects and convert IsActive to string
  return stateWrappers.map((wrapper) => ({
    Id: String(wrapper.State.Id),
    Name: wrapper.State.Name,
    Definition: wrapper.State.Definition,
    IsActive: String(wrapper.State.IsActive),
  }));
}

/**
 * Change state
 */
export async function changeState(stateName: string): Promise<void> {
  const client = getApiClient();
  await client.post(`/states/change/${stateName}.json`);
}
