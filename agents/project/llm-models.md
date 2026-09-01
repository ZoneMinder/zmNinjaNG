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
- The two system models, measured 2026-07-28 on the same 90 cases through each
  backend's real production path: Gemini Nano (Pixel 10) plans 33/38 and reads
  time 48/52; Apple Foundation Models (iPhone 17 Pro Max, iOS 26.5.2) plans
  21/38 and reads time 47-51/52. Nano is far better at planning; they are level
  on time. The no-tool half is the sharpest split: Nano 8/8, Apple 4/8, with
  Apple calling `list_events` three times for "who won the world cup in 2018"
  and `get_event` for "delete event 1234".
- Apple's planning deficit is NOT a prompt problem, and the trimmed prompt is
  not what causes it. Giving it the whole shared system prompt plus whole tool
  descriptions on the planning turn moved 21/38 to 23/38, inside its own
  run-to-run spread, and introduced failures that were not there before:
  arguments leaking between cases (a German window on two English questions)
  and junk in `objectType` ("NO", a tag name). Both attempts were reverted.
  What the extra text did fix is narrow and real: `count_events` chosen for a
  calendar window went from four failures to one, because that distinction
  lives past the first sentence of those two descriptions. Whether the rest is
  the model or the 4096-token window is unseparated.
- Apple's output SHAPE is flawless and its judgement is not: every one of its
  planning failures was a well-formed, schema-valid tool call that was simply
  the wrong call. Constrained decoding fixes shape and buys nothing else.
- AICore rate-limits a burst (`ErrorCode.BUSY`), which is NOT the plugin's own
  concurrency guard and must not share its code: running the contract eval
  straight after the time eval got every case rejected and reported 0/14 as if
  the model had failed them all. `RATE_LIMITED` is its own code now and the
  contract eval backs off and retries; a run reports how many retries it took
  (11 on the first clean run).

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
- A name enum cannot express abstention: asked which monitor a place means,
  qwen3:8b substituted the nearest listed name for a place the list lacks
  (12/16) under three prompt wordings and both enum orders. What worked
  (refs #427, temp 0, 2026-09): copy the place words first, then answer
  `covered` as its own boolean, then the names, with the no-coverage verdict
  derived in code from place+covered (21/24; time words the model copies
  into `place` are stripped in code via `scanTimeExpressions`). The model
  also emits the CONTRADICTION `covered: false` with a real name filled in
  (observed live on a paraphrase, refs #430); the parser leaves both slots
  unset then, since asserting no-coverage about a monitor the model itself
  named is the worst outcome.
- Adding the `when` slot to the parse flipped "front door" (no door
  monitor) from a clean noMatch to covered:true with the WHOLE roster selected,
  under two rule wordings (refs #434): unrelated schema fields perturb a
  borderline judgment, so re-run the parse eval after ANY parse-prompt or
  schema change. The fix is structural, not wording: a whole-roster
  selection leaves the slot unset, since it pins nothing an unpinned query
  lacks and is the false-cover signature.
- One question per judgment beats one consolidated call (refs #438,
  measured 2026-09): place coverage judged inside the full parse prompt
  failed live ("rear of my house" -> no-coverage with a Backyard monitor
  listed) and a `thinking` self-explanation field only ROTATED the failures
  across four wordings (each fix broke a previously passing case). The same
  model on a dedicated three-field coverage prompt scores 18/18 on every
  one of those cases, reasoning off, no extra rules. The interpreter's
  `meaning` field (restate which days the phrase covers, decoded first in
  every branch) is the same pattern at micro scale: "all this week" decoded
  none:true without it and a real window with it. Split the interrogation
  before tuning its wording.
- The full parse (refs #432, `prompt-eval.mts parse`, temp 0, 2026-09):
  slots as array enums (monitors as a SET, subject, objects) with an
  umbrella-coverage rule (a house contains what its monitors watch) scores 30/30
  on qwen3:8b, including "front of my house" -> both front monitors,
  "folks" -> person, and German -> the door monitor - the cases the single
  slot and the English category list failed. llama3.2 scores 8/20, mostly
  kind misroutes (ACTION for count questions); qwen3:8b remains the
  recommended Ollama model. With the `when` slot merged in (refs #434) the
  parse scores 36/36 and the separate extraction call is gone on the roster
  lane; the eval's extract stage still measures the roster-less fallback's
  model-only recall, where multi-phrase misses are pre-existing and the
  scan union covers them. After the #438 split, routing scores 24/24 and
  coverage 18/18, with every interpret class at 100% including the new
  calendar-week field and the meaning-first branches.
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
- A locked screen kills an on-device eval on BOTH platforms, and silently. On
  Android it is `BACKGROUND_USE_BLOCKED` per call; on iOS the app is suspended
  and the run simply stops with no report. Set Auto-Lock to Never (iOS) or rely
  on `svc power stayon true` (Android) before starting, and treat a run that
  produced no report, or far less wall-clock than the case count implies, as
  void rather than as a result.
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

- Two harnesses, one set of cases. `app/scripts/prompt-eval.mts` scores a
  backend over HTTP and so reaches only Ollama. The settings eval row
  (`system-model-eval.ts`) scores any `AssistantProvider` on-device, which is
  the only way a system model gets a number: neither Apple Foundation Models
  nor Gemini Nano has an HTTP surface. It runs both stages, time
  (`fm-eval.ts`) and tool contract (`contract-eval.ts`).
- The contract cases live in `contract-eval-cases.ts` and the time cases in
  `time-eval-cases.ts`, imported by BOTH harnesses. Never re-declare a case
  list in one of them.
- The contract eval passes a recording `runTool`. A backend that owns its tool
  loop (Apple) only reveals its calls by executing them, so without it the run
  silently scores that backend's fallback path instead of the production one.
- `app/scripts/prompt-eval.mts` imports the production `buildSystemPrompt`;
  never fork the prompt text into an eval. A hand-copied prompt drifted
  once and measured phantom failures. Two prompt rewrites shipped
  unmeasured, scored worse, and were reverted (refs #259).
- Plain `npx tsx` scripts cannot import app modules that read
  `import.meta.env`; use vitest with `// @vitest-environment node` and
  stub `Platform.shouldUseProxy` false, or `lib/http.ts` rewrites absolute
  URLs to the dev proxy.

This file owns model-selection, model-behavior, and eval facts. Tool-loop
conduct (grounding, error feedback) lives in the Assistant tool loop
contract; the remaining assistant code-path facts (markup parse failures,
locale-gated nudges) live in `domain-context.md`.
