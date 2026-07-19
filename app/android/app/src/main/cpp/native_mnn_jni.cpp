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

void unload() {
    if (model != nullptr) MNN::Transformer::Llm::destroy(model);
    model = nullptr;
    loadedPath.clear();
}

/** Loads `config` unless it is already the loaded model. Caller holds `mutex`. */
bool ensureLoaded(const std::string& config) {
    if (model != nullptr && loadedPath == config) return true;
    unload();
    model = MNN::Transformer::Llm::createLLM(config);
    if (model == nullptr) return false;
    model->set_config(ZMNINJA_MNN_RUNTIME_CONFIG);
    if (!model->load()) {
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

extern "C" JNIEXPORT jboolean JNICALL
Java_com_zoneminder_zmNinjaNG_NativeMnnPlugin_loadNative(JNIEnv* env, jclass, jstring configPath) {
    std::lock_guard<std::mutex> lock(mutex);
    return ensureLoaded(value(env, configPath)) ? JNI_TRUE : JNI_FALSE;
}

/** Returns {content, promptTokens, completionTokens}, or an empty array if the
 *  model could not be loaded. The token counts come from MNN's own context, so
 *  the app measures real context usage instead of guessing from characters. */
extern "C" JNIEXPORT jobjectArray JNICALL
Java_com_zoneminder_zmNinjaNG_NativeMnnPlugin_chatNative(
    JNIEnv* env, jclass, jstring configPath, jobjectArray roles, jobjectArray contents, jint maxTokens) {
    std::lock_guard<std::mutex> lock(mutex);
    jclass stringClass = env->FindClass("java/lang/String");
    if (!ensureLoaded(value(env, configPath))) return env->NewObjectArray(0, stringClass, nullptr);

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
