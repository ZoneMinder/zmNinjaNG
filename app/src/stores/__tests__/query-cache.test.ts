import { beforeEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { setQueryClient, removeProfileQueries } from '../query-cache';
import { asProfileId } from '../../api/types';

describe('removeProfileQueries', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    setQueryClient(queryClient);
  });

  it('removes only the given profile\'s cached queries', () => {
    queryClient.setQueryData(['monitors', 'p1'], ['m1']);
    queryClient.setQueryData(['monitors', 'p2'], ['m2']);
    queryClient.setQueryData(['events', 'p1', 'list'], ['e1']);

    removeProfileQueries(asProfileId('p1'));

    expect(queryClient.getQueryData(['monitors', 'p1'])).toBeUndefined();
    expect(queryClient.getQueryData(['events', 'p1', 'list'])).toBeUndefined();
    expect(queryClient.getQueryData(['monitors', 'p2'])).toEqual(['m2']);
  });

  it('does nothing when no query client has been set', () => {
    setQueryClient(null as unknown as QueryClient);
    expect(() => removeProfileQueries(asProfileId('p1'))).not.toThrow();
  });
});
