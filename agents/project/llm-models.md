# LLM model playbook

Model-selection and model-behavior facts for the in-app assistant. Read
before changing prompts, providers, tool schemas, or model defaults.
Measured claims come from `app/scripts/prompt-eval.mts` runs (temp 0,
2026-07) and carry issue or commit references; re-run the eval before and
after any prompt or provider change and put both scores in the PR.

## Backends

- Ollama (user's own server): the recommended remote path. WebLLM runs the
  on-device path in the browser and on Android; it is gated off on iOS
  (WKWebView's ~2GB jetsam limit kills model load), where remote Ollama is
  the supported path. Apple Foundation Models is the native Apple backend;
  a broader native on-device backend is tracked in issue #270.
- Gemini Nano (Android system model, ML Kit GenAI Prompt API over AICore) is
  the Android system backend. Unlike Apple's it cannot constrain output: ML
  Kit structured output is compile-time KSP codegen with no union type, so
  no per-tool turn schema and no removable answer branch. It is driven with
  the llama.cpp text contract instead. No native tool calling either.
- Gemini Nano is UNMEASURED: `prompt-eval.mts` has not been run against it.
  Three device spot checks held the turn contract (tool call on a data
  question, grounded answer after the result, no tool on a greeting), which
  is not a score.

## Measured model floor (prompt-eval, temp 0, 2026-07)

- `qwen3:8b`, `qwen3:30b-a3b`, `qwen3:4b`: 33/33 native tool-calling,
  24/24 constrained envelope. `qwen3:8b` is the recommended Ollama model.
- `llama3.2`: 33/33 native, 21/24 envelope.
- `qwen3:1.7b`: 21/33; below the 4b tier models fail the harness and are
  not worth supporting.

## Reasoning control

- The Ollama tag `qwen3:4b` resolves to Thinking-2507, whose reasoning
  cannot be disabled; use `qwen3:4b-instruct` when reasoning is unwanted.
- `/no_think` in a prompt is a placebo on Ollama: it hides the tag and
  still reasons at full latency. The real switch is
  `reasoning_effort: "none"` on the /v1 endpoint (about 5x faster, same
  eval scores); the adapter sends it only to confirmed-Ollama servers.
- WebLLM disables thinking with `extra_body: { enable_thinking: false }`.

## Patterns by model size

- Small and on-device models ignore prompt-only guardrails. Structural
  fixes are the ones that hold: the turn schema makes the answer branch
  unreachable without a real tool result (4ee2bbbf), failure paths append
  a correct-and-retry guard instead of echoing raw errors (0a720c01).
- Small models copy phrases perfectly but fail direct field-filling: time
  windows use copy-interpret-compute (model copies the phrase verbatim, a
  constrained interpreter call maps it to fields, code does arithmetic);
  measured direct fills scored 27/36 (qwen) and 15/36 (llama), refs #265.
- Prompt classification teaches dimensions (intent by subject), never
  instance lists; instance-based triage misclassified every combination
  outside its examples, four times.
- Apple Foundation Models invents tool arguments (validate before use) and
  calls real tools on greeting turns; the first tool call on a tool-less
  turn gets a no-tools pushback (578787dc).
- ML Kit GenAI capability docs are wrong on the device; probe at runtime.
  `nano-v3` on a Pixel 10 reports `getTokenLimit()` 8192 where the docs say
  under 4000, and `isSystemPromptAvailable()` false, so a `SystemInstruction`
  is accepted and ignored, silently dropping the tool catalog. Fold the
  system text into the prompt when that probe says false.
- AICore refuses inference unless the app is the foreground app
  (`BACKGROUND_USE_BLOCKED`) and meters each app daily
  (`PER_APP_BATTERY_USE_QUOTA_EXCEEDED`). Both are user-recoverable and need
  their own messages; "try again" is wrong advice for either.

## Eval harness

- `app/scripts/prompt-eval.mts` imports the production `buildSystemPrompt`;
  never fork the prompt text into an eval. A hand-copied prompt drifted
  once and measured phantom failures. Two prompt rewrites shipped
  unmeasured, scored worse, and were reverted (refs #259).
- Plain `npx tsx` scripts cannot import app modules that read
  `import.meta.env`; use vitest with `// @vitest-environment node` and
  stub `Platform.shouldUseProxy` false, or `lib/http.ts` rewrites absolute
  URLs to the dev proxy. Run vitest from `app/`, never the repo root (the
  root run resolves a different config and reports phantom failures).

This file owns model-selection, model-behavior, and eval facts. Tool-loop
conduct (grounding, error feedback) lives in the Assistant tool loop
contract; the remaining assistant code-path facts (markup parse failures,
locale-gated nudges) live in `domain-context.md`.
