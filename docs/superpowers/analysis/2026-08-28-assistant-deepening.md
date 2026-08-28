# Assistant module deepening survey (2026-08-28)

Survey of `app/src/lib/assistant/` and `app/src/components/assistant/` for
places where a deeper interface would have absorbed the fixes the area keeps
needing. Vocabulary: a module is anything with an interface and an
implementation; its interface is everything a caller must know (signature,
invariants, call ordering, error modes); depth is behaviour per unit of
interface; a seam is where an interface lives. The deletion test asks: delete
the module, does its complexity vanish, or reappear across N callers? One
adapter is a hypothetical seam, two is a real one. No source changed; the
"Assistant tool loop" contract, `agents/project/data-integrity.md` and
`agents/project/llm-models.md` bound every proposal below.

## Churn evidence

Commit subjects since 2026-07-01 matching `fix(assistant)`: 69, four times the
next area. Files changed most often in that window (commit count, non-merge):

- `components/assistant/AskPanel.tsx` 43
- `lib/assistant/__tests__/tools.test.ts` 37
- `lib/assistant/tools-readonly.ts` 35
- `lib/assistant/types.ts` 29
- `lib/assistant/agent.ts` 25
- `providers/webllm.ts` 22, `system-prompt.ts` 20, `tool-helpers.ts` 17
- `providers/apple-intelligence.ts` 13, `providers/openai.ts` 13

Derived counts from the same log:

- 28 of AskPanel's 43 commits also changed a non-test file under
  `lib/assistant/`. The panel is not a view; it is half of the turn.
- 17 commits touched the time pipeline (`timeframe-stage.ts`,
  `window-interpreter.ts`, `event-range.ts`); 10 of them are fixes.
- `tools.test.ts` is 1604 lines and changed in 37 commits, almost every
  `tool-helpers.ts` change (17) among them: the helper tests are the tool tests.
- Fix commits that changed three or more non-test assistant modules at once:
  8f40e127 (22 files), 38b62b0f (9), 982e28f5 (7), a981212d (6), c3562323 (5),
  e74bcb84, 4216f979, 3fcfff99, 35a49ae9 (4 each), e67650de, 7c36ff0f,
  17b83354 (3 each).

## Candidate 1: turn timeframes as one object

Files: `timeframe-stage.ts`, `window-interpreter.ts`, `event-range.ts`,
`tool-helpers.ts` (`whenNotFromQuestion`, `repairWhenPhrase`,
`calendarTimeframeMismatch`, `normalizeWhenPhrase`), `tools-readonly.ts`
(`list_events`, `count_events`), `types.ts` (`ToolContext.allowedWhenPhrases`,
`resolvedTimeframes`, `interpretWhen`, `question`, `timezone`),
`AskPanel.tsx`.

Problem. The `when` argument passes through six pure functions in a fixed
order that only `list_events`'s executor knows: provenance check, repair,
interpretation, arithmetic, empty-window rejection. The stage that resolves
timeframes up front (488a02c0) writes its output into three `ToolContext`
fields, and each tool re-derives from them: `list_events` reads
`allowedWhenPhrases` and `question`, `count_events` reads
`resolvedTimeframes`. The invariants live in nobody's interface: `phrases`
and `resolved` must be built from the same union (the doc comment on
`ExtractedTimeframes` explains when they diverge), a phrase equal to an
allowed phrase passes provenance even if absent from the question, repair
fires only when exactly one timeframe resolved and only under token
containment. Every one of these rules was a separate fix: bb32dfb5 added the
provenance check, 480898a7 the repair, 5e5d4525 the token match and the
containment gate, 7c36ff0f number-word folding, c3562323 parroted-phrase
filtering plus the calendar-versus-rolling refusal (five modules in one
commit), e657f33e the empty-window refusal. Each fix landed in
`tool-helpers.ts` plus `tools-readonly.ts` plus `tools.test.ts`, and the
bugs were in how the pure functions were sequenced, not in the functions.

Deletion test: delete `tool-helpers.ts`'s when-functions and the rules
reappear inline in `list_events`, `count_events`, and the stage's parroting
filter, which already duplicates the provenance idea with a substring check.
Three callers, so the seam is real, but it sits at the wrong level (free
functions over strings) instead of over the turn's resolved state.

Proposed interface. `extractTimeframes` returns a `TurnTimeframes` object and
`ToolContext` carries that one value instead of three. It exposes
`resolveWhen(phrase)` returning either a resolved window (with the repaired
phrase, for the log) or a corrective message for the model, and
`rollingWindowOrRefusal()` for `count_events`. Provenance, repair,
interpretation (through the injected interpreter), arithmetic, and the
empty-window and calendar checks all happen inside; the per-day interpreter
cache moves inside too. `list_events` shrinks to one call and cannot get the
order wrong. The stage's own parroting filter and `whenNotFromQuestion` share
one provenance function.

Tests. `tools.test.ts` describes `whenNotFromQuestion`,
`calendarTimeframeMismatch`, and the `list_events when resolution` cases move
to a `TurnTimeframes` test that asserts on `resolveWhen` outputs (window or
correction). The helper-level tests that assert a string contains a phrase
are deleted; the executor tests keep only "the filter reaching `getEvents`
matches what `resolveWhen` returned". The `extractTimeframes` tests stay as
they are, since that seam does not move.

Recommendation: Strong.

## Candidate 2: turn preparation out of AskPanel

Files: `AskPanel.tsx` (the send handler), `triage.ts`, `system-prompt.ts`,
`tools.ts` (`specializeToolSchemas`, `withServerArg`), `object-labels.ts`,
`scoped-servers.ts`, `timeframe-stage.ts`, `providers/provider.ts`.

Problem. The send handler builds the provider config, fetches the ZM version,
object labels, and scoped servers, builds the system prompt, builds
`ToolContext` (repeating the timezone expression three times), runs triage,
runs the timeframe stage, rewrites the system prompt for a non-data turn,
specialises and scopes the tool schemas, then calls `runAssistantTurn`. A
comment in that block says the server roster "drives three things that must
agree": the prompt, the `server` enum, and the sessions the tool wrapper may
reach. Object labels drive two (prompt and `objectType` enum, 3535d14a).
Timeframes drive two (`ToolContext` and the appended system line). Nothing
enforces any of these agreements; the panel is the only place they meet, and
28 of its 43 commits also changed library code. The aggregate work (948ec2df,
bb8b2ab5) and the timeframe stage (488a02c0, c3562323) each grew this block.

Deletion test: delete the handler and every agreement rule has to be
rediscovered by the next caller (the eval harness in `system-model-eval.ts`
already re-implements part of it to score a backend, per `llm-models.md`).

Proposed interface. A `prepareTurn(input)` module in `lib/assistant/` takes
the question, profile, settings, scope, and provider, and returns a
`TurnPlan`: system prompt, tools, `ToolContext`, request kind, initial trace,
or an abstention. The roster, labels, and timeframes are computed once and
applied to prompt, schemas, and context inside; the three-way agreement
becomes an invariant of one function. AskPanel keeps store reads, the abort
controller, test-mode script wiring, and the thread append. The eval harness
calls the same function so it scores the production path (a stated goal in
`llm-models.md`).

Tests. New `prepare-turn.test.ts` asserting that a server named in the plan's
prompt is also in the `server` enum and in `ctx.servers`, that labels in the
prompt equal the `objectType` enum, that an abstention yields no tools. The
AskPanel tests that check what the handler passed to `runAssistantTurn`
(`AskPanel.allmode.test.tsx`, parts of `AskPanel.test.tsx`) move down; the
component tests keep rendering and status assertions only.

Recommendation: Strong.

## Candidate 3: argument repair owned by the tool

Files: `agent.ts` (`runOneCall`), `tool-helpers.ts` (`stripOmittedArgs`,
`repairCountEventsInterval`, `objectQuestionMismatch`, `objectTypeUngrounded`,
`validateToolInput`), `tools-readonly.ts`, `types.ts` (`ToolDefinition`).

Problem. Repairs are split by accident of history. `count_events`'s interval
repair runs in `agent.ts` before validation (8f1fde92, which touched the
loop, the helpers, and two test files); `list_events`'s objectType drop and
`when` repair run inside its executor (480898a7); the object-question refusal
runs in the loop with a tool-name switch. A tool author has to know that some
repairs happen before `validateToolInput` and some after `safeExecute`, and
that `runOneCall` special-cases one tool by name. The closure holds six
pieces of turn state, and the Apple backend's native loop reaches the same
closure through `runTool` (0f952c6f), so any ordering change affects both
paths.

Deletion test: delete the loop's repair step and the repair reappears in the
executor, which is where `list_events`'s already is. One caller, so the seam
is hypothetical today; it becomes real the moment a third tool needs a
repair.

Proposed interface. `ToolDefinition` gains an optional `repair(input, ctx)`
that runs after `stripOmittedArgs` and before `validateToolInput`, returning
the input to validate or a correction for the model. `count_events` and
`list_events` own theirs; the loop's `call.name === 'count_events'` branch and
`objectQuestionMismatch`'s tool-name switch go away. The rest of `runOneCall`
(pushback, withheld names, duplicate signature, execution, tracing) stays.

Tests. `agent.test.ts` "argument normalization before a tool runs" keeps the
strip case and loses the count_events case, which moves to `tools.test.ts`
as a `count_events.repair` test. `repairCountEventsInterval` and
`objectQuestionMismatch` helper tests are deleted in favour of tests on the
tool's `repair`.

Recommendation: Worth exploring. Depends on Candidate 1, which removes the
largest repair from `list_events` first.

## Candidate 4: one prompt-contract turn runner for the four JSON backends

Files: `providers/webllm.ts`, `providers/openai.ts`,
`providers/native-llm.ts`, `providers/gemini-nano.ts`,
`providers/apple-intelligence.ts`, `exchange.ts`, `providers/usage.ts`.

Problem. `buildWebLlmMessages` and `parseWebLlmTurn` are imported by four
providers; the builder takes eight positional parameters, four of them
booleans, and the Apple provider calls it as `(…, false, true, false, false)`.
The parse-retry loop (attempt counter, `SELF_REPAIR_PROMPT` append, raised
temperature on the last attempt, `PARSE_ERROR_TEXT` with `raw` for the panel,
`captureExchange`) exists in `OpenAiProvider.chat` and `WebLlmProvider.chat`
and again in the native and Nano adapters. Fixes to the contract landed per
provider: 3533e3ad (label fell through to another backend), 5e67741d and
7cebd66c (format teaching leaking into the Apple prompt), d165c63e (native
round budget). `llm-models.md` records that Nano cannot constrain output and
Apple can, so the variation is real, but it is two dimensions (constrained or
not; native tool loop or not), not five files.

Deletion test: delete `webllm.ts`'s exported helpers and the message shape
and parser reappear in four adapters. Four callers make this a real seam; the
problem is that it is a pair of functions rather than the loop that uses
them.

Proposed interface. A `runContractTurn(generate, opts)` in `providers/` owns
message building, retry, parse, `raw`, usage, and exchange capture. A backend
supplies `generate(messages, schema?)` and a small options object naming its
capabilities (`constrained`, `fewShot`, `thinkingSwitch`) instead of boolean
positions. Apple keeps its native tool loop and calls the runner only for the
tool-less path. Provider classes shrink to platform gating, plugin errors, and
`complete`.

Tests. The `.chat` retry cases in the WebLLM, OpenAI, and native provider
tests collapse into one runner test; `parseWebLlmTurn` and
`buildOpenAiMessages` tests stay. Per-provider tests keep gate and errors.

Recommendation: Worth exploring. Larger blast radius; do after Candidates 1
and 2, and re-run the contract eval before and after as `llm-models.md`
requires.

## Candidate 5: answer acceptance as a policy object

Files: `agent.ts` (the `toolCalls.length === 0` branch), `grounding.ts`,
`agent-failopen.test.ts`.

Problem. Whether an answer is accepted, retried with a correction, or replaced
by the data fallback is decided by five booleans in `runAssistantTurn`
(`groundingRetried`, `genericToolReminderSent`, `toolLessPushbackSent`,
`anyToolCallAttempted`, `activeTools`), each added by a fix (0a720c01,
578787dc, e74bcb84, c766bd4e). The ordering of the checks is only visible by
reading the loop.

Proposed interface. `judgeAnswer(turn, state)` in `grounding.ts` returning
`accept`, `retry(message)`, or `replace(text)`, with the turn state as an
explicit record. The loop applies the verdict. Tests in `agent.test.ts`
"grounding check" and `agent-failopen.test.ts` become table tests over
`judgeAnswer`; the end-to-end cases that assert what the mock provider
received stay, reduced to one per verdict.

Recommendation: Speculative. One caller, and the contract gate already
covers the behaviour; the gain is readability, not fewer fixes.

## Top recommendation

Candidate 1, turn timeframes as one object, then Candidate 2. Candidate 1
matches the churn most directly: ten fix commits in the time pipeline and six
more in the `when` guards, every one of them a change to how correct pure
functions were sequenced or which context field they read. Moving that
sequence behind `TurnTimeframes.resolveWhen` gives the tools one call, makes
the stage's output and the tools' input the same type, and turns the
provenance and repair tests into tests of an outcome the user sees (which
window was queried) instead of which string a helper returned. It changes no
prompt text, so it needs no eval re-run, and it stays inside the
copy-interpret-compute design `domain-context.md` requires. Candidate 2 then
takes the resulting object out of AskPanel along with the other two
agreements, which is what would have absorbed the aggregate and stage commits.
