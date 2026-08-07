/**
 * Multi-server tool execution (refs #337).
 *
 * A turn inside a server group has to be able to say WHICH server a number
 * came from. These cover the three things that makes possible: resolving a
 * server name the model typed, running one tool against one server's session
 * and display context, and fanning out over the whole group when the model
 * named no server at all.
 */

import { describe, it, expect, vi } from 'vitest';
import { executeScoped, resolveServerArg, contextForServer } from '../server-scope';
import { asProfileId } from '../../../api/types';
import type { ScopedServer, ToolContext, ToolDefinition } from '../types';

const isaac: ScopedServer = {
  profileId: asProfileId('p-isaac'),
  name: 'isaac',
  portalUrl: 'http://isaac',
  accessToken: 'tok-isaac',
  timezone: 'America/New_York',
};
const home: ScopedServer = {
  profileId: asProfileId('p-home'),
  name: 'home',
  portalUrl: 'http://home',
  accessToken: 'tok-home',
  timezone: 'Europe/Berlin',
};

function ctxWith(servers?: ScopedServer[]): ToolContext {
  return {
    profileId: asProfileId('p-isaac'),
    portalUrl: 'http://isaac',
    accessToken: 'tok-isaac',
    timezone: 'America/New_York',
    servers,
    queryClient: {} as ToolContext['queryClient'],
    host: {
      navigate: vi.fn(),
      onActivity: vi.fn(),
    } as unknown as ToolContext['host'],
  };
}

/** A tool that reports which profile and portal it ran against, plus one card. */
function probeTool(): ToolDefinition {
  return {
    name: 'probe',
    description: 'test',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    execute: vi.fn(async (input, ctx) => ({
      output: JSON.stringify({
        summary: `ran on ${ctx.profileId}`,
        matchCount: 1,
        portalUrl: ctx.portalUrl,
        input,
      }),
      display: [
        {
          kind: 'event' as const,
          id: '7',
          title: 'Front Door',
          navigatePath: '/events/7',
          cacheKey: '7',
        },
      ],
    })),
  };
}

describe('resolveServerArg', () => {
  const servers = [isaac, home];

  it('matches a name exactly, ignoring case and surrounding space', () => {
    expect(resolveServerArg(' Isaac ', servers)).toEqual({ server: isaac });
  });

  it('matches an unambiguous prefix', () => {
    expect(resolveServerArg('hom', servers)).toEqual({ server: home });
  });

  it('names the real servers when the model invents one', () => {
    const result = resolveServerArg('basement', servers);
    expect('error' in result && result.error).toContain('isaac');
    expect('error' in result && result.error).toContain('home');
  });

  it('refuses an ambiguous prefix rather than guessing', () => {
    const result = resolveServerArg('h', [home, { ...home, name: 'hallway' }]);
    expect('error' in result).toBe(true);
  });
});

describe('contextForServer', () => {
  it('swaps in the server\'s own session id and display inputs', () => {
    const scoped = contextForServer(ctxWith([isaac, home]), home);
    expect(scoped.profileId).toBe('p-home');
    expect(scoped.portalUrl).toBe('http://home');
    expect(scoped.accessToken).toBe('tok-home');
    expect(scoped.timezone).toBe('Europe/Berlin');
  });
});

describe('executeScoped', () => {
  it('runs the tool untouched when the turn has no server group', async () => {
    const tool = probeTool();
    const result = await executeScoped(tool, { limit: 5 }, ctxWith());

    expect(tool.execute).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.output).summary).toBe('ran on p-isaac');
    // No group, so no per-server wrapper and no rewritten card path.
    expect(result.display?.[0].navigatePath).toBe('/events/7');
  });

  it('runs against only the named server when the model names one', async () => {
    const tool = probeTool();
    const result = await executeScoped(tool, { server: 'home' }, ctxWith([isaac, home]));

    expect(tool.execute).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.output);
    expect(parsed.servers).toHaveLength(1);
    expect(parsed.servers[0].server).toBe('home');
    expect(parsed.servers[0].result.portalUrl).toBe('http://home');
    // `server` is the wrapper's own argument, never forwarded to the tool.
    expect(parsed.servers[0].result.input).toEqual({});
  });

  it('reports the valid server names instead of querying one when the name is unknown', async () => {
    const tool = probeTool();
    const result = await executeScoped(tool, { server: 'basement' }, ctxWith([isaac, home]));

    expect(tool.execute).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.output).toContain('isaac');
  });

  it('fans out over every server when the model names none', async () => {
    const tool = probeTool();
    const result = await executeScoped(tool, {}, ctxWith([isaac, home]));

    expect(tool.execute).toHaveBeenCalledTimes(2);
    const parsed = JSON.parse(result.output);
    expect(parsed.servers.map((s: { server: string }) => s.server)).toEqual(['isaac', 'home']);
    expect(parsed.servers.map((s: { result: { summary: string } }) => s.result.summary)).toEqual([
      'ran on p-isaac',
      'ran on p-home',
    ]);
    // The grounding fallback reads a top-level `summary` (grounding.ts), so the
    // merged result carries one naming every server.
    expect(parsed.summary).toContain('isaac');
    expect(parsed.summary).toContain('home');
  });

  it('labels each card with its server and points it at that server\'s route', async () => {
    const result = await executeScoped(probeTool(), {}, ctxWith([isaac, home]));

    expect(result.display?.map((d) => d.server)).toEqual(['isaac', 'home']);
    expect(result.display?.map((d) => d.navigatePath)).toEqual([
      '/all/events/p-isaac/7',
      '/all/events/p-home/7',
    ]);
    // Raw ZM ids collide across servers, so the card cache key has to be
    // composite (aggregation contract).
    expect(new Set(result.display?.map((d) => d.cacheKey)).size).toBe(2);
  });

  it('keeps the servers that worked when one of them fails', async () => {
    const tool = probeTool();
    vi.mocked(tool.execute).mockImplementation(async (_input, ctx) => {
      if (ctx.profileId === 'p-home') throw new Error('offline');
      return { output: JSON.stringify({ summary: 'ran on isaac', matchCount: 2 }) };
    });

    const result = await executeScoped(tool, {}, ctxWith([isaac, home]));

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.output);
    expect(parsed.servers[0].result.matchCount).toBe(2);
    expect(parsed.servers[1].error).toContain('offline');
  });

  it('is an error only when every server fails', async () => {
    const tool = probeTool();
    vi.mocked(tool.execute).mockRejectedValue(new Error('offline'));

    const result = await executeScoped(tool, {}, ctxWith([isaac, home]));

    expect(result.isError).toBe(true);
    expect(result.output).toContain('offline');
  });
});
