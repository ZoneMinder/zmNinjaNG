// Runtime config applied to every MNN LLM before load(), shared by the Android
// JNI (android/app/src/main/cpp/native_mnn_jni.cpp) and the iOS bridge
// (ios/App/App/NativeMnnBridge.mm) so the two platforms cannot drift apart.
//
// Applied BEFORE load(), never after: the sampler is constructed during load()
// and does not re-read config afterwards.
//
// - temperature/topP: MNN defaults to temperature 1.0, far too loose for the
//   strict single-JSON-object contract the assistant imposes on the model.
// - prompt_cache: lets Llm::response(ChatMessages) reuse the KV prefix it
//   shares with the previous tool iteration instead of re-prefilling the whole
//   conversation. It falls back to a full re-prefill by itself when history is
//   trimmed, so it stays correct across a context clear.
// - timeout_ms: a generation that runs away would otherwise hold the global
//   model mutex forever, since MNN exposes no cancel and the JS-side abort
//   cannot reach a call already in flight. MNN marks the context TIMEOUT and
//   returns instead (see llm.cpp's timeout check against prefill_us).
#pragma once

#define ZMNINJA_MNN_RUNTIME_CONFIG \
    R"({"temperature":0.2,"topP":0.8,"prompt_cache":true,"timeout_ms":120000})"
