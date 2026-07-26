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

The code-path conduct rules behind several of these entries (tool-loop
gating, markup parse failures, locale-gated nudges) live in
`domain-context.md` and the Assistant tool loop contract; this file is for
choosing and configuring models.
