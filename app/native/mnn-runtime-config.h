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
// - timeout_ms: bounds PREFILL only. MNN checks it once, right after prefill
//   (llm.cpp's "check timeout after prefill"), and never again during decode,
//   so it does NOT bound a long generation. Decode length is governed solely
//   by max_new_tokens, which the caller passes per request.
//
// The backend is chosen per platform by the caller, not here: Android compiles
// no Metal and iOS compiles no OpenCL, so a shared value would be wrong on one
// of them. See ZMNINJA_MNN_GPU_BACKEND in each bridge.
#pragma once

#include <memory>
#include <string>

#include <MNN/Interpreter.hpp>
#include <MNN/expr/Executor.hpp>

/** Fields identical on both platforms. Kept as a fragment rather than a whole
 *  object so each bridge can add its own backend and cache path. */
#define ZMNINJA_MNN_COMMON_CONFIG \
    "\"temperature\":0.2,\"topP\":0.8,\"prompt_cache\":true,\"timeout_ms\":120000"

/**
 * Full config JSON for one model, given the platform's GPU backend name and the
 * directory holding the model.
 *
 * `tmp_path` is required whenever the backend is not CPU: MNN writes a compiled
 * shader/kernel cache next to it, and with no path set it falls back to the
 * process working directory (llm.cpp: `tmpPath.length() != 0 ? tmpPath : "."`),
 * which is not reliably writable on either platform. Pointing it at the model's
 * own directory keeps the cache inside the app sandbox and lets the second
 * launch skip kernel compilation.
 *
 * MNN falls back to CPU on its own if the GPU runtime cannot be created
 * (Executor.cpp retries as MNN_FORWARD_CPU when the runtime is null), and keeps
 * a CPU runtime alongside for operators the GPU backend does not implement. So
 * naming a backend the device turns out not to support degrades to today's
 * behaviour rather than failing.
 */
inline std::string zmninjaMnnConfig(const char* backendType, const std::string& modelDirectory) {
    return std::string("{") + ZMNINJA_MNN_COMMON_CONFIG +
           ",\"backend_type\":\"" + backendType + "\"" +
           ",\"tmp_path\":\"" + modelDirectory + "\"}";
}

/** Directory part of `configPath` (the model folder), used for `tmp_path`. */
inline std::string zmninjaMnnModelDirectory(const std::string& configPath) {
    const size_t slash = configPath.find_last_of('/');
    return slash == std::string::npos ? std::string(".") : configPath.substr(0, slash);
}

/**
 * The backend MNN would ACTUALLY use for `requested`, which is not always the
 * one asked for: a device with no usable GPU driver silently degrades to CPU
 * inside Executor, and the caller is never told. Reporting the requested value
 * would claim GPU acceleration on hardware running entirely on the CPU, which
 * is exactly what a user needs to know when a reply takes minutes.
 *
 * Probes with the public RuntimeManager API rather than reaching into Llm:
 * build a runtime with the same forward type and ask what it resolved to.
 * `getInfo` leaves the value untouched for codes it does not handle, so the
 * result is seeded with the requested type and only overwritten on success.
 */
inline MNNForwardType zmninjaMnnResolveBackend(MNNForwardType requested) {
    MNN::ScheduleConfig config;
    config.type = requested;
    std::shared_ptr<MNN::Express::Executor::RuntimeManager> manager(
        MNN::Express::Executor::RuntimeManager::createRuntimeManager(config));
    if (manager == nullptr) return MNN_FORWARD_CPU;
    int resolved = static_cast<int>(requested);
    manager->getInfo(MNN::Interpreter::BACKENDS, &resolved);
    return static_cast<MNNForwardType>(resolved);
}

/** Stable, user-facing token for a forward type. The JS layer localizes around
 *  these rather than translating them, so they must stay fixed and lowercase. */
inline const char* zmninjaMnnBackendName(MNNForwardType type) {
    switch (type) {
        case MNN_FORWARD_METAL: return "metal";
        case MNN_FORWARD_OPENCL: return "opencl";
        case MNN_FORWARD_VULKAN: return "vulkan";
        default: return "cpu";
    }
}
