/**
 * Running one tool call across a group of servers (refs #337).
 *
 * A virtual profile combines several ZoneMinder servers, but every tool in
 * `tools-readonly.ts` is written against exactly one: it calls
 * `getSession(ctx.profileId)` and builds card thumbnails from the one portal
 * URL and token on the context. Teaching each of them to fan out would mean
 * rewriting their summaries, hour tallies and truncation logic N times over.
 *
 * So the fan-out lives here instead, one level up, at the single place the
 * agent loop executes a tool (`agent.ts`). A tool still runs against one
 * server and knows nothing about groups; this wrapper decides WHICH server or
 * servers, runs the tool once per server against a context swapped to that
 * server, and merges the results into one payload that names each server.
 *
 * The model's half of the contract is the `server` argument (`withServerArg`
 * in tools.ts) plus the roster in the system prompt: it sets `server` when the
 * user names one, and omits it to cover the whole group.
 */

import type { DisplayEntity, ScopedServer, ToolContext, ToolDefinition, ToolExecuteResult } from './types';
import { isOmittedArg } from './tool-helpers';

/** The wrapper's own argument, stripped before the tool sees the input: a tool
 *  declares `additionalProperties: false` and knows nothing about servers. */
export const SERVER_ARG = 'server';

/**
 * Turns the model's `server` value into one of the servers in scope.
 *
 * Exact match first, then an unambiguous prefix, both case-insensitive: the
 * model is asked to copy a name from the enum, and the tolerance is for the
 * turns where it types "hom" or capitalizes. An ambiguous prefix is an error
 * rather than a guess - answering about the wrong server is worse than asking
 * again, because nothing in the answer would reveal the mistake.
 */
export function resolveServerArg(
  raw: unknown,
  servers: readonly ScopedServer[],
): { server: ScopedServer } | { error: string } {
  const needle = String(raw ?? '').trim().toLowerCase();
  const names = servers.map((s) => s.name).join(', ');
  if (!needle) return { error: `server is required. The servers in this view are: ${names}.` };

  const exact = servers.filter((s) => s.name.toLowerCase() === needle);
  if (exact.length === 1) return { server: exact[0] };

  const prefixed = servers.filter((s) => s.name.toLowerCase().startsWith(needle));
  if (prefixed.length === 1) return { server: prefixed[0] };
  if (prefixed.length > 1) {
    return {
      error: `"${String(raw)}" matches more than one server (${prefixed.map((s) => s.name).join(', ')}). Use the full name.`,
    };
  }
  return {
    error: `There is no server named "${String(raw)}" in this view. The servers are: ${names}. Use one of those names exactly, or omit server to cover all of them.`,
  };
}

/**
 * The turn's context, pointed at one server.
 *
 * Everything server-specific is replaced together - session id, portal URL,
 * token, streaming port, thumbnail chain, timezone - because a half-swapped
 * context is what produces a card from one server carrying another's token.
 * `servers` itself is dropped: the tool underneath is single-server by
 * construction, and leaving the roster on the context it receives invites a
 * second fan-out inside one.
 */
/* ponytail: `interpretWhen` stays bound to the pinned profile's timezone (the
 * closure AskPanel built), while the arithmetic that follows it runs in the
 * server's own zone below. The phrase-to-fields step barely depends on the
 * zone, so the two only disagree for a phrase asked across a midnight boundary
 * between servers in different zones. Upgrade path: make `interpretWhen` take
 * the timezone as an argument and re-bind it here. */
export function contextForServer(ctx: ToolContext, server: ScopedServer): ToolContext {
  return {
    ...ctx,
    servers: undefined,
    profileId: server.profileId,
    portalUrl: server.portalUrl ?? ctx.portalUrl,
    accessToken: server.accessToken ?? null,
    minStreamingPort: server.minStreamingPort ?? ctx.minStreamingPort,
    thumbnailFallbackChain: server.thumbnailFallbackChain ?? ctx.thumbnailFallbackChain,
    timezone: server.timezone ?? ctx.timezone,
  };
}

/** Cards, labelled with the server they came from and pointed at that
 *  server's all-mode deep route. The raw ZM id is not unique across servers
 *  (aggregation contract), so the card's cache key becomes a composite; the
 *  navigate path gets the same treatment for the same reason. */
function tagDisplay(display: DisplayEntity[] | undefined, server: ScopedServer): DisplayEntity[] {
  return (display ?? []).map((entity) => ({
    ...entity,
    server: server.name,
    profileId: server.profileId,
    cacheKey: `${server.profileId}:${entity.cacheKey ?? entity.id}`,
    navigatePath:
      entity.kind === 'event'
        ? `/all/events/${server.profileId}/${entity.id}`
        : `/all/monitors/${server.profileId}/${entity.id}`,
  }));
}

/** A tool's own output, parsed when it is the JSON every read tool returns, so
 *  the merged payload nests real objects instead of escaped strings the model
 *  then has to unescape. */
function parseOutput(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

interface ServerRun {
  server: string;
  result?: unknown;
  error?: string;
}

/**
 * The merged payload.
 *
 * `summary` is deliberately at the top level and deliberately a string:
 * `fallbackAnswerFromData` (grounding.ts) reads exactly that field when a
 * model fails to write an answer of its own, and a group turn must not lose
 * that safety net. It names each server because a total that does not say
 * which server it came from is the bug this whole change exists to fix.
 */
function mergeRuns(runs: ServerRun[]): string {
  const summary = runs
    .map((run) => {
      const inner = (run.result as { summary?: unknown } | undefined)?.summary;
      if (run.error) return `${run.server}: ${run.error}`;
      return `${run.server}: ${typeof inner === 'string' && inner ? inner : 'no summary'}`;
    })
    .join(' ');
  return JSON.stringify({ summary, servers: runs });
}

/**
 * Executes one tool call for the turn's server scope.
 *
 * Three paths, in the order they are decided:
 * - No group (a single-profile install, or a context without a roster): the
 *   tool runs exactly as it always did, same context object, no wrapper around
 *   its output. Every existing single-server behavior and test depends on this.
 * - `server` named: resolved, then run once against that server.
 * - `server` omitted inside a group: run once per server, in parallel, and
 *   merged.
 *
 * A server that fails does not fail the call: its message rides in the merged
 * payload next to the servers that answered, because "the other three servers
 * saw nothing" is still an answer. Only an all-failed call is an error, and
 * then the messages are what the model gets.
 */
export async function executeScoped(
  def: ToolDefinition,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolExecuteResult> {
  const servers = ctx.servers ?? [];
  const { [SERVER_ARG]: rawServer, ...toolInput } = input;

  if (servers.length < 2) return def.execute(toolInput, ctx);

  const targets: ScopedServer[] = [];
  if (!isOmittedArg(rawServer)) {
    const resolved = resolveServerArg(rawServer, servers);
    if ('error' in resolved) return { output: resolved.error, isError: true };
    targets.push(resolved.server);
  } else {
    targets.push(...servers);
  }

  const outcomes = await Promise.all(
    targets.map(async (server) => {
      try {
        const result = await def.execute(toolInput, contextForServer(ctx, server));
        // A tool that reports its own failure (safeExecute's `isError`) counts
        // as a failed server, not as data: its `output` is a message.
        if (result.isError) return { server, error: result.output, display: [] as DisplayEntity[] };
        return { server, result, display: tagDisplay(result.display, server) };
      } catch (e) {
        return { server, error: e instanceof Error ? e.message : 'Tool failed', display: [] as DisplayEntity[] };
      }
    }),
  );

  const runs: ServerRun[] = outcomes.map((outcome) =>
    outcome.error !== undefined
      ? { server: outcome.server.name, error: outcome.error }
      : { server: outcome.server.name, result: parseOutput(outcome.result!.output) },
  );
  const allFailed = outcomes.every((outcome) => outcome.error !== undefined);
  if (allFailed) {
    return {
      output: outcomes.map((outcome) => `${outcome.server.name}: ${outcome.error}`).join('\n'),
      isError: true,
    };
  }

  return { output: mergeRuns(runs), display: outcomes.flatMap((outcome) => outcome.display) };
}
