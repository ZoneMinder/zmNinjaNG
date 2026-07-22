// NativeLlm JNI engine. Mirrors app/ios/App/App/LlamaEngine.swift: owns one
// resident llama.cpp model (keyed by modelId), runs serial CPU inference, frees
// on unload/delete. The Java plugin (NativeLlmPlugin.java) owns files, download,
// threading and the serial busy-guard; this layer owns the native pointers.
#include <jni.h>
#include <android/log.h>
#include <mutex>
#include <atomic>
#include <string>
#include <vector>
#include <thread>
#include <algorithm>

#include "llama.h"
#include "ggml-backend.h"

#define LOG_TAG "NativeLlm"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

namespace {

std::mutex g_lock;                 // guards the resident model pointer/id
std::atomic<bool> g_cancel{false}; // per-token cancel flag, set from any thread
bool g_backend_ready = false;
llama_model *g_model = nullptr;
std::string g_loaded_id;

// Persistent context + its KV, kept resident across chat calls so a repeated prefix
// (tool rounds, retries, growing history) is not re-prefilled. g_cached = the exact
// token sequence currently in the KV (prompt + generated) from the previous call.
llama_context *g_ctx = nullptr;
int g_ctx_size = 0;                    // n_ctx the resident ctx was built with
std::vector<llama_token> g_cached;

void free_context_locked() {
    if (g_ctx) { llama_free(g_ctx); g_ctx = nullptr; }
    g_ctx_size = 0;
    g_cached.clear();
}

void free_model_locked() {
    free_context_locked();
    if (g_model) {
        llama_model_free(g_model);
        g_model = nullptr;
        g_loaded_id.clear();
    }
}

// Reuse the resident context if it matches the requested size, else (re)create it.
// A different contextSize discards the KV. Must be called under g_lock.
llama_context *ensure_context_locked(llama_model *model, int n_ctx_req, int n_threads) {
    if (g_ctx && g_ctx_size == n_ctx_req) return g_ctx;
    free_context_locked();
    llama_context_params cp = llama_context_default_params();
    cp.n_ctx = (uint32_t) n_ctx_req;
    cp.n_batch = cp.n_ctx; // whole prefill decoded in one llama_decode
    cp.n_threads = n_threads;
    cp.n_threads_batch = n_threads;
    g_ctx = llama_init_from_model(model, cp);
    if (g_ctx) g_ctx_size = n_ctx_req;
    return g_ctx;
}

// Load (or reuse) the resident model. Caller holds no lock; we take it here.
llama_model *ensure_model(const std::string &model_id, const std::string &model_path) {
    std::lock_guard<std::mutex> lk(g_lock);
    if (g_model && g_loaded_id == model_id) return g_model;
    free_model_locked();
    llama_model_params mparams = llama_model_default_params();
    mparams.n_gpu_layers = 0; // CPU backend only on Android
    llama_model *m = llama_model_load_from_file(model_path.c_str(), mparams);
    if (!m) return nullptr;
    g_model = m;
    g_loaded_id = model_id;
    return m;
}

void throw_engine_failed(JNIEnv *env, const char *msg) {
    jclass cls = env->FindClass("java/lang/RuntimeException");
    if (cls) env->ThrowNew(cls, msg);
}

std::string jstr(JNIEnv *env, jstring s) {
    if (!s) return {};
    const char *c = env->GetStringUTFChars(s, nullptr);
    std::string out(c ? c : "");
    if (c) env->ReleaseStringUTFChars(s, c);
    return out;
}

// Render OpenAI-shaped messages (already split into role/content arrays by Java)
// with the model's built-in chat template. Two-pass buffer sizing.
bool apply_template(llama_model *model, JNIEnv *env, jobjectArray roles,
                    jobjectArray contents, std::string &out) {
    jsize n = env->GetArrayLength(roles);
    if (n <= 0) return false;
    std::vector<std::string> role_s(n), content_s(n);
    std::vector<llama_chat_message> msgs(n);
    for (jsize i = 0; i < n; i++) {
        jstring r = (jstring) env->GetObjectArrayElement(roles, i);
        jstring c = (jstring) env->GetObjectArrayElement(contents, i);
        role_s[i] = jstr(env, r);
        content_s[i] = jstr(env, c);
        msgs[i].role = role_s[i].c_str();
        msgs[i].content = content_s[i].c_str();
        env->DeleteLocalRef(r);
        env->DeleteLocalRef(c);
    }
    const char *tmpl = llama_model_chat_template(model, nullptr);
    if (!tmpl) return false;
    std::vector<char> buf(8192);
    int32_t need = llama_chat_apply_template(tmpl, msgs.data(), msgs.size(), true,
                                             buf.data(), (int32_t) buf.size());
    if (need > (int32_t) buf.size()) {
        buf.resize(need);
        need = llama_chat_apply_template(tmpl, msgs.data(), msgs.size(), true,
                                         buf.data(), need);
    }
    if (need <= 0) return false;
    out.assign(buf.data(), need);
    return true;
}

// parse_special = true: the prompt is templated, so control tokens tokenize as
// control tokens, not literal text (hard-won device lesson, see Swift).
std::vector<llama_token> tokenize(const llama_vocab *vocab, const std::string &text) {
    int cap = (int) text.size() + 2;
    std::vector<llama_token> tokens(cap);
    int n = llama_tokenize(vocab, text.c_str(), (int) text.size(), tokens.data(),
                           cap, true, true);
    if (n < 0) { // returned -needed
        tokens.resize(-n);
        n = llama_tokenize(vocab, text.c_str(), (int) text.size(), tokens.data(),
                           -n, true, true);
    }
    if (n <= 0) return {};
    tokens.resize(n);
    return tokens;
}

// Raw bytes for one token (may be an incomplete UTF-8 fragment); accumulated and
// decoded once by Java, matching the Swift multi-byte discipline.
void append_piece(const llama_vocab *vocab, llama_token token, std::vector<char> &acc) {
    char buf[8];
    int n = llama_token_to_piece(vocab, token, buf, sizeof(buf), 0, false);
    if (n < 0) {
        std::vector<char> big(-n);
        int n2 = llama_token_to_piece(vocab, token, big.data(), (int) big.size(), 0, false);
        if (n2 > 0) acc.insert(acc.end(), big.begin(), big.begin() + n2);
        return;
    }
    acc.insert(acc.end(), buf, buf + n);
}

} // namespace

extern "C" {

JNIEXPORT jbyteArray JNICALL
Java_com_zoneminder_zmNinjaNG_NativeLlmPlugin_nativeChat(
        JNIEnv *env, jclass, jstring j_model_id, jstring j_model_path, jstring j_lib_dir,
        jobjectArray roles, jobjectArray contents,
        jdouble temperature, jint max_tokens, jint context_size, jintArray out_counts) {

    {
        std::lock_guard<std::mutex> lk(g_lock);
        if (!g_backend_ready) {
            // GGML_BACKEND_DL: the ggml-cpu variant .so are dlopen'd at runtime, and ggml's
            // auto-search uses /proc/self/exe's dir — which on Android is app_process, not the
            // app's lib dir. So we must point the loader at the app's nativeLibraryDir explicitly
            // (mirrors llama.cpp's own examples/llama.android). Without this no CPU backend loads.
            std::string lib_dir = jstr(env, j_lib_dir);
            ggml_backend_load_all_from_path(lib_dir.empty() ? nullptr : lib_dir.c_str());
            llama_backend_init();
            g_backend_ready = true;
        }
    }
    g_cancel = false;

    std::string model_id = jstr(env, j_model_id);
    std::string model_path = jstr(env, j_model_path);

    llama_model *model = ensure_model(model_id, model_path);
    if (!model) { throw_engine_failed(env, "Failed to load model"); return nullptr; }
    const llama_vocab *vocab = llama_model_get_vocab(model);

    std::string prompt;
    if (!apply_template(model, env, roles, contents, prompt)) {
        throw_engine_failed(env, "Failed to apply chat template"); return nullptr;
    }

    // Thread count = performance cores only. Big.LITTLE Android SoCs pair the big cluster with
    // ~4 little (A5xx) cores that straggle on prefill; on-device llama-bench (Pixel 8 / Tensor G3,
    // 1 X3 + 4 A715 + 4 A510 = 9 hw threads) pp512 peaked at 5 threads (16.19 t/s) and REGRESSED
    // at 7 (15.78) — the 4 little cores hurt. hw-4 drops the little cluster (9-4=5 here); clamped
    // [4,6] so odd core counts stay sane.
    int hw = (int) std::thread::hardware_concurrency();
    int n_threads = std::max(4, std::min(6, hw - 4));

    // Persistent context, sized by the caller (recreated only if contextSize changed).
    // Serial execution (Java chatInFlight gate + single-thread executor) makes the ctx a
    // single owner during the chat, so the KV work below needs no lock; only the create/free
    // of g_ctx is guarded (vs the trim free, which the executor also serializes).
    llama_context *ctx;
    {
        std::lock_guard<std::mutex> lk(g_lock);
        ctx = ensure_context_locked(model, std::max(256, (int) context_size), n_threads);
    }
    if (!ctx) { throw_engine_failed(env, "Failed to initialize context"); return nullptr; }

    // Sampler chain: greedy at temperature 0, else top-k/top-p/min-p/temp.
    llama_sampler *smpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
    if (temperature <= 0) {
        llama_sampler_chain_add(smpl, llama_sampler_init_greedy());
    } else {
        llama_sampler_chain_add(smpl, llama_sampler_init_top_k(40));
        llama_sampler_chain_add(smpl, llama_sampler_init_top_p(0.95f, 1));
        llama_sampler_chain_add(smpl, llama_sampler_init_min_p(0.05f, 1));
        llama_sampler_chain_add(smpl, llama_sampler_init_temp((float) temperature));
        llama_sampler_chain_add(smpl, llama_sampler_init_dist(0xFFFFFFFF));
    }

    std::vector<llama_token> prompt_tokens = tokenize(vocab, prompt);
    int n_ctx = (int) llama_n_ctx(ctx);
    if (prompt_tokens.empty() || (int) prompt_tokens.size() >= n_ctx) {
        llama_sampler_free(smpl);
        throw_engine_failed(env, "Prompt exceeds context size"); return nullptr;
    }

    // KV reuse: keep the longest prefix already in the KV, evict the divergent tail,
    // prefill only the changed suffix. Back off by one if the whole prompt is cached
    // (must decode at least the last token to get logits to sample from).
    size_t n_common = 0;
    size_t maxc = std::min(g_cached.size(), prompt_tokens.size());
    while (n_common < maxc && g_cached[n_common] == prompt_tokens[n_common]) n_common++;
    if (n_common == prompt_tokens.size()) n_common--;
    llama_memory_seq_rm(llama_get_memory(ctx), 0, (llama_pos) n_common, -1);
    LOGI("KV reuse: prompt=%zu cached=%zu common=%zu prefill=%zu",
         prompt_tokens.size(), g_cached.size(), n_common, prompt_tokens.size() - n_common);

    int suffix = (int) prompt_tokens.size() - (int) n_common;
    llama_batch batch = llama_batch_init(std::max(1, suffix), 0, 1);
    auto add_token = [&](llama_token id, llama_pos pos, bool logits) {
        int i = batch.n_tokens;
        batch.token[i] = id;
        batch.pos[i] = pos;
        batch.n_seq_id[i] = 1;
        batch.seq_id[i][0] = 0;
        batch.logits[i] = logits ? 1 : 0;
        batch.n_tokens++;
    };

    batch.n_tokens = 0;
    for (size_t i = n_common; i < prompt_tokens.size(); i++)
        add_token(prompt_tokens[i], (llama_pos) i, false);
    batch.logits[batch.n_tokens - 1] = 1; // sample from the last prompt token

    if (llama_decode(ctx, batch) != 0) {
        llama_batch_free(batch); llama_sampler_free(smpl);
        g_cached.clear(); // KV now inconsistent -> full re-prefill next call
        throw_engine_failed(env, "Failed to decode prompt"); return nullptr;
    }

    // Generation loop. On cancel, stop and return the partial completion (the JS
    // side turns an aborted call into AbortError regardless of resolve/reject).
    std::vector<char> pieces;
    std::vector<llama_token> generated;
    int completion = 0;
    bool kv_valid = true;
    llama_pos n_cur = (llama_pos) prompt_tokens.size();
    while (completion < max_tokens && n_cur < (llama_pos) n_ctx) {
        if (g_cancel.load()) { kv_valid = false; break; } // partial gen in KV -> drop cache
        llama_token new_token = llama_sampler_sample(smpl, ctx, -1);
        if (llama_vocab_is_eog(vocab, new_token)) break;
        append_piece(vocab, new_token, pieces);
        generated.push_back(new_token);
        completion++;

        batch.n_tokens = 0;
        add_token(new_token, n_cur, true);
        n_cur++;
        if (llama_decode(ctx, batch) != 0) { kv_valid = false; break; }
    }

    llama_batch_free(batch);
    llama_sampler_free(smpl);
    // ctx persists. Update the cache to exactly what the KV now holds (prompt + generated),
    // or drop it if generation left the KV in a partial state.
    if (kv_valid) {
        g_cached = prompt_tokens;
        g_cached.insert(g_cached.end(), generated.begin(), generated.end());
    } else {
        g_cached.clear();
    }

    // promptTokens stays the FULL prompt count (JS context-window accounting depends on it),
    // NOT the prefilled suffix.
    jint counts[2] = { (jint) prompt_tokens.size(), (jint) completion };
    env->SetIntArrayRegion(out_counts, 0, 2, counts);

    jbyteArray result = env->NewByteArray((jsize) pieces.size());
    if (!pieces.empty())
        env->SetByteArrayRegion(result, 0, (jsize) pieces.size(),
                                reinterpret_cast<const jbyte *>(pieces.data()));
    return result;
}

JNIEXPORT void JNICALL
Java_com_zoneminder_zmNinjaNG_NativeLlmPlugin_nativeCancelChat(JNIEnv *, jclass) {
    g_cancel = true;
}

JNIEXPORT void JNICALL
Java_com_zoneminder_zmNinjaNG_NativeLlmPlugin_nativeUnload(JNIEnv *, jclass) {
    std::lock_guard<std::mutex> lk(g_lock);
    free_model_locked();
}

// Memory valve: free the resident context + KV (keep the model). Called from the plugin's
// onTrimMemory via the chat executor, so it never races an in-flight chat. Next chat pays
// one full prefill to rebuild.
JNIEXPORT void JNICALL
Java_com_zoneminder_zmNinjaNG_NativeLlmPlugin_nativeFreeContext(JNIEnv *, jclass) {
    std::lock_guard<std::mutex> lk(g_lock);
    if (g_ctx) { LOGI("freeing KV context under memory pressure"); free_context_locked(); }
}

JNIEXPORT void JNICALL
Java_com_zoneminder_zmNinjaNG_NativeLlmPlugin_nativeFreeIfLoaded(
        JNIEnv *env, jclass, jstring j_model_id) {
    std::lock_guard<std::mutex> lk(g_lock);
    if (g_model && g_loaded_id == jstr(env, j_model_id)) free_model_locked();
}

} // extern "C"
