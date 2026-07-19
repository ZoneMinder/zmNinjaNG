#include <jni.h>
#include <mutex>
#include <sstream>
#include <string>
#include <vector>
#include <llm/llm.hpp>
#include "mnn-runtime-config.h"

namespace {
std::mutex mutex;
MNN::Transformer::Llm* model = nullptr;
std::string loadedPath;
/** Backend the loaded model actually resolved to, reported to the UI. */
std::string loadedBackend = "cpu";
/** True when the GPU crashed a previous launch and CPU was forced. */
bool gpuCrashedBefore = false;

/** CPU on Android, from measurement rather than preference. Both GPU backends
 *  MNN offers here were tried on a Pixel 8 (Mali G715) and both lost:
 *
 *  OpenCL  killed the process building the model (SIGSEGV, null KernelWrap in
 *          OpenCLRuntime::getMaxWorkGroupSize from AttentionBufExecution::
 *          prefillResize; its attention kernel does not compile on Mali).
 *  Vulkan  ran without crashing but doubled memory, 1.9GB resident on CPU
 *          against 3.7GB, which pushed an 8GB phone into heavy swapping
 *          (70% iowait, 2.76GB swap) and left ONE thread at 78% where the CPU
 *          backend keeps four near 120%. Slower, not faster. The cause is
 *          visible in logcat as a flood of "Clone error for convolution/
 *          deconvolution, will Increase memory": the Vulkan backend does not
 *          implement onClone for convolution, so every such op keeps its own
 *          execution instead of sharing weights.
 *
 *  Upstream agrees on the default without ruling the GPU out. Alibaba's own
 *  Android LLM app compiles OpenCL (-DMNN_OPENCL=true) yet leaves the LLM
 *  backend unset so the model config's "cpu" wins, exposing GPU only as a user
 *  setting, and its README states plainly that "in GPU-based assessments,
 *  MNN-LLM's performance slightly declines". Issue #3371 reports OpenCL LLM
 *  decode at 2.5 tok/s against a documented 11 on a Snapdragon 8 Gen 3, the
 *  Attention operator accounting for 21 seconds of it: the same operator that
 *  crashes here, so this is not a Mali-only problem.
 *
 *  So Android has no GPU backend compiled at all (see CMakeLists.txt) and this
 *  stays CPU: `useGpu` is accepted for a shared bridge signature but has nothing
 *  to select here, and the Settings toggle is shown only on iOS, where Metal
 *  does work. The marker-file guard above remains for that iOS path.
 *
 *  iOS uses Metal, which is a different backend on different hardware and is
 *  unaffected by any of this (see NativeMnnBridge.mm). */
constexpr MNNForwardType kPreferredBackend = MNN_FORWARD_CPU;

void unload() {
    if (model != nullptr) MNN::Transformer::Llm::destroy(model);
    model = nullptr;
    loadedPath.clear();
    loadedBackend = "cpu";
}

/** Loads `config` unless it is already the loaded model. Caller holds `mutex`. */
bool ensureLoaded(const std::string& config, bool useGpu) {
    if (model != nullptr && loadedPath == config) return true;
    unload();
    model = MNN::Transformer::Llm::createLLM(config);
    if (model == nullptr) return false;
    const std::string directory = zmninjaMnnModelDirectory(config);
    // Skip the GPU entirely if a previous attempt never came back (see
    // zmninjaMnnGpuCrashedBefore): that device gets CPU permanently.
    gpuCrashedBefore = zmninjaMnnGpuCrashedBefore(directory);
    MNNForwardType backend = (useGpu && !gpuCrashedBefore) ? zmninjaMnnResolveBackend(kPreferredBackend) : MNN_FORWARD_CPU;
    if (backend != MNN_FORWARD_CPU) zmninjaMnnMarkGpuAttempt(directory);
    loadedBackend = zmninjaMnnBackendName(backend);
    model->set_config(zmninjaMnnConfig(loadedBackend.c_str(), directory));
    const bool ok = model->load();
    // Reached only if the GPU did not take the process down.
    zmninjaMnnClearGpuAttempt(directory);
    if (!ok) {
        unload();
        return false;
    }
    loadedPath = config;
    return true;
}

std::string value(JNIEnv* env, jstring input) {
    if (input == nullptr) return std::string();
    const char* raw = env->GetStringUTFChars(input, nullptr);
    std::string result(raw);
    env->ReleaseStringUTFChars(input, raw);
    return result;
}

/** JNI strings are modified UTF-8: a generation cut off mid-token can leave a
 *  truncated multi-byte sequence at the tail, and handing that to NewStringUTF
 *  is undefined behaviour. Drops an incomplete trailing sequence rather than
 *  losing the whole (otherwise valid) reply. */
void dropTruncatedUtf8Tail(std::string& text) {
    size_t i = text.size();
    while (i > 0 && (static_cast<unsigned char>(text[i - 1]) & 0xC0) == 0x80) i--;
    if (i == 0) return;
    const unsigned char lead = static_cast<unsigned char>(text[i - 1]);
    size_t expected = 1;
    if ((lead & 0xE0) == 0xC0) expected = 2;
    else if ((lead & 0xF0) == 0xE0) expected = 3;
    else if ((lead & 0xF8) == 0xF0) expected = 4;
    if (expected > 1 && text.size() - (i - 1) < expected) text.resize(i - 1);
}
}

/** Returns the backend actually in use ("opencl"/"cpu"), or an empty string if
 *  the model could not be loaded. */
extern "C" JNIEXPORT jstring JNICALL
Java_com_zoneminder_zmNinjaNG_NativeMnnPlugin_loadNative(JNIEnv* env, jclass, jstring configPath, jboolean useGpu) {
    std::lock_guard<std::mutex> lock(mutex);
    if (!ensureLoaded(value(env, configPath), useGpu == JNI_TRUE)) return env->NewStringUTF("");
    // "cpu!" marks a forced fall back after a GPU crash, so the app can say so.
    return env->NewStringUTF((loadedBackend + (gpuCrashedBefore ? "!" : "")).c_str());
}

/** Returns {content, promptTokens, completionTokens}, or an empty array if the
 *  model could not be loaded. The token counts come from MNN's own context, so
 *  the app measures real context usage instead of guessing from characters. */
extern "C" JNIEXPORT jobjectArray JNICALL
Java_com_zoneminder_zmNinjaNG_NativeMnnPlugin_chatNative(
    JNIEnv* env, jclass, jstring configPath, jobjectArray roles, jobjectArray contents, jint maxTokens, jboolean useGpu) {
    std::lock_guard<std::mutex> lock(mutex);
    jclass stringClass = env->FindClass("java/lang/String");
    if (!ensureLoaded(value(env, configPath), useGpu == JNI_TRUE)) return env->NewObjectArray(0, stringClass, nullptr);

    // ChatMessages, not a flattened string: this routes through the overload
    // that applies the model's own chat template, so every turn carries real
    // role markers. It also owns KV-state correctness across calls (it clears
    // or rolls back stale history itself), which the string overload did not:
    // that one appended each call's tokens to the previous call's KV while the
    // caller was already re-sending the whole conversation.
    const jsize count = roles == nullptr ? 0 : env->GetArrayLength(roles);
    MNN::Transformer::ChatMessages chat;
    chat.reserve(static_cast<size_t>(count));
    for (jsize i = 0; i < count; i++) {
        auto role = static_cast<jstring>(env->GetObjectArrayElement(roles, i));
        auto content = static_cast<jstring>(env->GetObjectArrayElement(contents, i));
        chat.emplace_back(value(env, role), value(env, content));
        env->DeleteLocalRef(role);
        env->DeleteLocalRef(content);
    }
    if (chat.empty()) return env->NewObjectArray(0, stringClass, nullptr);

    std::ostringstream response;
    model->response(chat, &response, nullptr, maxTokens);
    std::string text = response.str();
    dropTruncatedUtf8Tail(text);

    const auto* context = model->getContext();
    jobjectArray result = env->NewObjectArray(3, stringClass, nullptr);
    env->SetObjectArrayElement(result, 0, env->NewStringUTF(text.c_str()));
    env->SetObjectArrayElement(result, 1, env->NewStringUTF(std::to_string(context->prompt_len).c_str()));
    env->SetObjectArrayElement(result, 2, env->NewStringUTF(std::to_string(context->gen_seq_len).c_str()));
    return result;
}

extern "C" JNIEXPORT void JNICALL
Java_com_zoneminder_zmNinjaNG_NativeMnnPlugin_unloadNative(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> lock(mutex);
    unload();
}
