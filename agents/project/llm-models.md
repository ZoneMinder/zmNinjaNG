# LLM model playbook

Model-selection and model-behavior facts for the in-app assistant. Read
before changing prompts, providers, tool schemas, or model defaults.
Measured claims come from `app/scripts/prompt-eval.mts` runs (temp 0,
2026-07) and carry issue or commit references; re-run the eval before and
after any prompt or provider change and put both scores in the PR.

## Backends

- Ollama (user's own server) is the most accurate everywhere and the head of
  every platform's ranking; `qwen3:8b` is the recommended model. Below it:
  iOS runs llama.cpp (Qwen3 4B Instruct) on Metal then Apple Foundation
  Models; Android runs Gemini Nano; web runs WebLLM on WebGPU. WebLLM is
  gated off on iOS (WKWebView's ~2GB jetsam limit kills model load).
- llama.cpp is iOS-only. It was removed from the Android build (issue #270):
  no GPU path there meant ~6.6 tok/s decode against Gemini Nano's ~1.5s
  replies, for 76MB of native libraries and a 2.5GB model download. Do not
  reintroduce it without a working Vulkan/NPU path and a measured win.
- Gemini Nano (Android system model, ML Kit GenAI Prompt API over AICore) is
  the Android system backend. Unlike Apple's it cannot constrain output: ML
  Kit structured output is compile-time KSP codegen with no union type, so
  no per-tool turn schema and no removable answer branch. It is driven with
  the llama.cpp text contract instead. No native tool calling either.
- Gemini Nano `nano-v3` on a Pixel 10 scores 48/52 on the time eval
  (interpret 33/36, extract 15/16, ~97s), reproduced twice via the settings
  eval row. Remaining failures: "past 5 days" as `daysAgo` not rolling,
  "this weekend" as last, "this month" as the wrong month, and a German
  extract falling back to today. Apple Foundation Models has no score on
  these cases yet, so the two system models are NOT yet comparable.

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
- A dozing or locked screen counts as background, which silently invalidates
  any batch run on this backend. A first Gemini Nano eval scored 27/52 with
  whole classes at zero; all of those failures were `BACKGROUND_USE_BLOCKED`,
  not wrong answers, and the same eval scored 48/52 unlocked. Before trusting
  an on-device number, confirm the run has no such error in the log
  (`ON_LOCKED` in `dumpsys nfc`, `mWakefulness=Dozing` in `dumpsys power`)
  and keep the phone unlocked with the app in front for the whole run. A run
  that took far less wall-clock than the case count implies is the tell.
- Never cancel an ML Kit GenAI call. genai-prompt 1.0.0-beta4 is compiled
  against kotlinx-coroutines 1.7.3, where `Job.cancel$default` lives in
  `Job$DefaultImpls`; the app resolves 1.10.2, which dropped that class, so
  ML Kit's cancellation path throws `NoSuchMethodError` on its own thread
  pool and kills the process. `GeminiNanoPlugin.cancelChat` abandons the
  call instead of cancelling it.

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
