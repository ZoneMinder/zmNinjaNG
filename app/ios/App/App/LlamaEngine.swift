import Foundation
import LlamaKit

/// Result of one chat completion.
struct LlamaChatResult {
    let content: String
    let promptTokens: Int
    let completionTokens: Int
}

enum LlamaEngineError: Error, LocalizedError {
    case modelLoadFailed
    case contextInitFailed
    case templateFailed
    case promptTooLong
    case busy
    case cancelled

    var errorDescription: String? {
        switch self {
        case .modelLoadFailed: return "Failed to load model"
        case .contextInitFailed: return "Failed to initialize context"
        case .templateFailed: return "Failed to apply chat template"
        case .promptTooLong: return "Prompt exceeds context size"
        case .busy: return "A chat is already running"
        case .cancelled: return "Chat cancelled"
        }
    }
}

// MARK: - llama_batch Swift helpers (not exported by the C header)

private func batchClear(_ batch: inout llama_batch) {
    batch.n_tokens = 0
}

private func batchAdd(_ batch: inout llama_batch, _ id: llama_token, _ pos: llama_pos, _ seqIds: [llama_seq_id], _ logits: Bool) {
    let i = Int(batch.n_tokens)
    batch.token[i] = id
    batch.pos[i] = pos
    batch.n_seq_id[i] = Int32(seqIds.count)
    for j in 0..<seqIds.count {
        batch.seq_id[i]![j] = seqIds[j]
    }
    batch.logits[i] = logits ? 1 : 0
    batch.n_tokens += 1
}

/// Boxes the status callback so llama.cpp's context-free C `progress_callback` can reach it
/// via `user_data`. 5%-delta throttle guards the JS bridge from spam during weight load.
private final class ProgressBox {
    let onStatus: (String, Double, Int, Int, Int, Int) -> Void
    var lastLoad: Float = -1
    init(_ onStatus: @escaping (String, Double, Int, Int, Int, Int) -> Void) { self.onStatus = onStatus }
    func report(_ p: Float) {
        if p - lastLoad >= 0.05 || p >= 1.0 {
            lastLoad = p
            onStatus("loading_model", Double(p), 0, 0, 0, 0)
        }
    }
}

/// Owns the resident llama.cpp model and runs inference. Serial: a second concurrent
/// chat is rejected with `.busy`. Model stays resident across chats (keyed by modelId),
/// freed on unload/deleteModel. A context is created per chat with the caller's contextSize.
final class LlamaEngine {
    static let shared = LlamaEngine()

    private let lock = NSLock()
    private var backendReady = false
    private var busy = false
    private var cancelRequested = false
    private var loadedModelId: String?
    private var model: OpaquePointer?

    // Persistent context + its KV, kept resident across chat calls so a repeated prefix
    // (tool rounds, retries, growing history) is not re-prefilled. `cached` = the exact
    // token sequence currently in the KV (prompt + generated) from the previous call.
    private var ctx: OpaquePointer?
    private var ctxSize = 0                 // n_ctx the resident ctx was built with
    // One KV sequence PER PURPOSE (slot 0 = chat, slot 1 = triage): they use different
    // system prompts, so sharing one sequence made each triage call's seq_rm evict the
    // conversation cache. `cached[slot]` is the exact token sequence in that slot's KV.
    private var cached: [[llama_token]] = [[], []]
    private var freeCtxPending = false      // memory warning arrived mid-chat; free when it ends

    private init() {}

    // MARK: Lifecycle

    /// True while a chat is generating. Callers (delete/unload) use it to avoid
    /// freeing the model out from under a running chat (use-after-free).
    var isBusy: Bool {
        lock.lock(); defer { lock.unlock() }
        return busy
    }

    func cancelChat() {
        lock.lock(); cancelRequested = true; lock.unlock()
    }

    /// Free the resident model. Safe to call while idle.
    func unload() {
        lock.lock(); defer { lock.unlock() }
        freeModelLocked()
    }

    /// Free the model if the given id is the one resident (called on delete).
    func unloadIfLoaded(modelId: String) {
        lock.lock(); defer { lock.unlock() }
        if loadedModelId == modelId { freeModelLocked() }
    }

    private func freeModelLocked() {
        freeContextLocked()
        if let m = model {
            llama_model_free(m)
            model = nil
            loadedModelId = nil
        }
    }

    private func freeContextLocked() {
        if let c = ctx { llama_free(c); ctx = nil }
        ctxSize = 0
        cached = [[], []]
    }

    /// Memory valve: free the resident context + KV (keep the model). If a chat is running it
    /// still needs the ctx, so defer the free until the chat's `defer` fires. Next chat pays
    /// one full prefill to rebuild. Mirrors Android's onTrimMemory hook.
    func freeContextUnderPressure() {
        lock.lock(); defer { lock.unlock() }
        if busy {
            freeCtxPending = true
        } else if ctx != nil {
            NSLog("NativeLlm: freeing KV context under memory pressure")
            freeContextLocked()
        }
    }

    /// Reuse the resident context if it matches the requested size, else (re)create it.
    /// A different contextSize discards the KV.
    private func ensureContext(model: OpaquePointer, nCtx: Int, nThreads: Int32) throws -> OpaquePointer {
        lock.lock(); defer { lock.unlock() }
        if let c = ctx, ctxSize == nCtx { return c }
        freeContextLocked()
        var cparams = llama_context_default_params()
        cparams.n_ctx = UInt32(nCtx)
        cparams.n_batch = cparams.n_ctx // whole prefill decoded in one llama_decode
        cparams.n_threads = nThreads
        cparams.n_threads_batch = nThreads
        // Two purpose-specific KV sequences (chat/triage). kv_unified keeps the KV a single
        // shared n_ctx-cell pool where each sequence can address the full n_ctx, instead of the
        // default even split (n_ctx/n_seq_max) that would halve chat's window. Slots share the
        // token budget; triage is tiny, so chat keeps effectively its full context.
        cparams.n_seq_max = 2
        cparams.kv_unified = true
        guard let c = llama_init_from_model(model, cparams) else { throw LlamaEngineError.contextInitFailed }
        ctx = c
        ctxSize = nCtx
        return c
    }

    // MARK: Chat

    func chat(modelId: String, modelPath: String, messagesJson: String,
              temperature: Double, maxTokens: Int, contextSize: Int, cacheSlot: Int = 0,
              onStatus: ((String, Double, Int, Int, Int, Int) -> Void)? = nil) throws -> LlamaChatResult {
        let slot = cacheSlot == 1 ? 1 : 0            // 0 = chat, 1 = triage (separate KV sequences)
        let seq = llama_seq_id(slot)
        // Serial guard: reject a second concurrent chat cleanly.
        lock.lock()
        if busy { lock.unlock(); throw LlamaEngineError.busy }
        busy = true
        cancelRequested = false
        if !backendReady { llama_backend_init(); backendReady = true }
        lock.unlock()
        defer {
            lock.lock()
            if freeCtxPending { freeContextLocked(); freeCtxPending = false }
            busy = false
            lock.unlock()
        }

        let progressBox = onStatus.map { ProgressBox($0) }
        let model = try ensureModel(modelId: modelId, modelPath: modelPath, progressBox: progressBox)
        let vocab = llama_model_get_vocab(model)

        let prompt = try applyTemplate(model: model, messagesJson: messagesJson)

        // Persistent context, sized by the caller (recreated only if contextSize changed).
        let nThreads = Int32(max(1, min(8, ProcessInfo.processInfo.processorCount - 2)))
        let ctx = try ensureContext(model: model, nCtx: max(256, contextSize), nThreads: nThreads)

        // Sampler chain: greedy at temperature 0, else top-k/top-p/min-p/temp (llama.cpp CLI defaults).
        let smpl = llama_sampler_chain_init(llama_sampler_chain_default_params())
        defer { llama_sampler_free(smpl) }
        if temperature <= 0 {
            llama_sampler_chain_add(smpl, llama_sampler_init_greedy())
        } else {
            llama_sampler_chain_add(smpl, llama_sampler_init_top_k(40))
            llama_sampler_chain_add(smpl, llama_sampler_init_top_p(0.95, 1))
            llama_sampler_chain_add(smpl, llama_sampler_init_min_p(0.05, 1))
            llama_sampler_chain_add(smpl, llama_sampler_init_temp(Float(temperature)))
            llama_sampler_chain_add(smpl, llama_sampler_init_dist(0xFFFF_FFFF))
        }

        let promptTokens = tokenize(vocab: vocab, text: prompt, addBos: true)
        let nCtx = Int(llama_n_ctx(ctx))
        // Checks THIS slot's prompt against n_ctx, but with kv_unified both slots share the
        // n_ctx-cell pool: combined slot occupancy near n_ctx can still fail a later llama_decode.
        // Recoverable, not corrupting — the slot's cache is dropped on failure and re-prefilled
        // from seq_rm 0 next call; JS context auto-clear shrinks slot 0. Accepted ceiling.
        guard !promptTokens.isEmpty, promptTokens.count < nCtx else { throw LlamaEngineError.promptTooLong }

        // KV reuse: keep the longest prefix already in the KV, evict the divergent tail, prefill
        // only the changed suffix. Back off by one if the whole prompt is cached (must decode at
        // least the last token to sample from its logits).
        var nCommon = 0
        let maxCommon = min(cached[slot].count, promptTokens.count)
        while nCommon < maxCommon && cached[slot][nCommon] == promptTokens[nCommon] { nCommon += 1 }
        if nCommon == promptTokens.count { nCommon -= 1 }
        llama_memory_seq_rm(llama_get_memory(ctx), seq, llama_pos(nCommon), -1)

        let suffix = promptTokens.count - nCommon
        // Prefill chunk size = one status tick per chunk. Metal prefill is fast (hundreds of
        // tok/s), so 1024 already ticks often enough and keeps batch efficiency; Android CPU
        // (~16 tok/s) uses 256 for visible progress — see llama_jni.cpp.
        let chunkSize = 1024
        var batch = llama_batch_init(Int32(max(1, min(suffix, chunkSize))), 0, 1)
        defer { llama_batch_free(batch) }

        // Chunked prefill so the long first-fill reports progress between llama_decode calls.
        // n_batch = n_ctx keeps each chunk a single batch; 1024 is perf-negligible vs one big batch.
        let chunks = (suffix + chunkSize - 1) / chunkSize
        var lastPrefill: Float = -1
        var start = nCommon
        while start < promptTokens.count {
            let end = min(start + chunkSize, promptTokens.count)
            batchClear(&batch)
            for i in start..<end { batchAdd(&batch, promptTokens[i], llama_pos(i), [seq], false) }
            let isLast = end == promptTokens.count
            if isLast { batch.logits[Int(batch.n_tokens) - 1] = 1 } // sample from the last prompt token
            guard llama_decode(ctx, batch) == 0 else {
                cached[slot].removeAll() // this slot's KV now inconsistent -> full re-prefill next call
                throw LlamaEngineError.contextInitFailed
            }
            let chunk = (start - nCommon) / chunkSize + 1 // 1-based
            let pr = Float(end - nCommon) / Float(suffix)
            if pr - lastPrefill >= 0.05 || isLast {
                lastPrefill = pr
                onStatus?("prefill", Double(pr), suffix, nCommon, chunk, chunks)
            }
            start = end
        }

        // Generation loop. On cancel, stop and return the partial completion (the JS side turns
        // an aborted call into AbortError regardless), dropping the cache since the KV is partial.
        var pieces: [CChar] = []
        var generated: [llama_token] = []
        var completion = 0
        var kvValid = true
        var nCur = llama_pos(promptTokens.count)
        while completion < maxTokens && nCur < llama_pos(nCtx) {
            lock.lock(); let cancelled = cancelRequested; lock.unlock()
            if cancelled { kvValid = false; break }

            let newToken = llama_sampler_sample(smpl, ctx, -1)
            if llama_vocab_is_eog(vocab, newToken) { break }

            pieces.append(contentsOf: tokenToPiece(vocab: vocab, token: newToken))
            generated.append(newToken)
            completion += 1

            batchClear(&batch)
            batchAdd(&batch, newToken, nCur, [seq], true)
            nCur += 1
            if llama_decode(ctx, batch) != 0 { kvValid = false; break }
        }

        // ctx persists. Update the cache to exactly what the KV now holds (prompt + generated),
        // or drop it if generation left the KV partial.
        cached[slot] = kvValid ? promptTokens + generated : []

        // promptTokens stays the FULL prompt count (JS context-window accounting depends on it),
        // NOT the prefilled suffix.
        let content = String(cString: pieces + [0])
        return LlamaChatResult(content: content, promptTokens: promptTokens.count, completionTokens: completion)
    }

    // MARK: Helpers

    private func ensureModel(modelId: String, modelPath: String, progressBox: ProgressBox? = nil) throws -> OpaquePointer {
        if loadedModelId == modelId, let m = model { return m } // cache hit: no load, emit nothing
        freeModelLocked()
        var mparams = llama_model_default_params()
        #if targetEnvironment(simulator)
        mparams.n_gpu_layers = 0
        #else
        mparams.n_gpu_layers = 99
        #endif
        if let box = progressBox {
            // Context-free C callback reaches the box via user_data. `box` outlives this
            // synchronous load, so passUnretained is safe.
            mparams.progress_callback = { progress, ctx in
                guard let ctx = ctx else { return true }
                Unmanaged<ProgressBox>.fromOpaque(ctx).takeUnretainedValue().report(progress)
                return true
            }
            mparams.progress_callback_user_data = Unmanaged.passUnretained(box).toOpaque()
        }
        guard let m = llama_model_load_from_file(modelPath, mparams) else { throw LlamaEngineError.modelLoadFailed }
        model = m
        loadedModelId = modelId
        return m
    }

    /// Render OpenAI-shaped messages with the model's built-in chat template.
    private func applyTemplate(model: OpaquePointer, messagesJson: String) throws -> String {
        guard let data = messagesJson.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw LlamaEngineError.templateFailed
        }

        var cStrings: [UnsafeMutablePointer<CChar>] = []
        defer { cStrings.forEach { free($0) } }
        var msgs: [llama_chat_message] = []
        for m in arr {
            let role = strdup((m["role"] as? String) ?? "user")!
            let content = strdup((m["content"] as? String) ?? "")!
            cStrings.append(role); cStrings.append(content)
            msgs.append(llama_chat_message(role: role, content: content))
        }
        guard !msgs.isEmpty else { throw LlamaEngineError.templateFailed }

        guard let tmpl = llama_model_chat_template(model, nil) else { throw LlamaEngineError.templateFailed }

        var buf = [CChar](repeating: 0, count: 8192)
        var n = llama_chat_apply_template(tmpl, msgs, msgs.count, true, &buf, Int32(buf.count))
        if n > Int32(buf.count) {
            buf = [CChar](repeating: 0, count: Int(n))
            n = llama_chat_apply_template(tmpl, msgs, msgs.count, true, &buf, n)
        }
        guard n > 0 else { throw LlamaEngineError.templateFailed }
        return String(cString: Array(buf[0..<Int(n)]) + [0])
    }

    private func tokenize(vocab: OpaquePointer?, text: String, addBos: Bool) -> [llama_token] {
        let utf8Count = text.utf8.count
        let capacity = utf8Count + (addBos ? 1 : 0) + 1
        let tokens = UnsafeMutablePointer<llama_token>.allocate(capacity: capacity)
        defer { tokens.deallocate() }
        // parse_special = true: the prompt is templated, so <|im_start|> etc. must tokenize as control tokens, not literal text.
        let n = llama_tokenize(vocab, text, Int32(utf8Count), tokens, Int32(capacity), addBos, true)
        guard n > 0 else { return [] }
        return (0..<Int(n)).map { tokens[$0] }
    }

    /// Piece for one token, without null terminator (may be an incomplete UTF-8 fragment).
    private func tokenToPiece(vocab: OpaquePointer?, token: llama_token) -> [CChar] {
        var buf = [CChar](repeating: 0, count: 8)
        let n = llama_token_to_piece(vocab, token, &buf, Int32(buf.count), 0, false)
        if n < 0 {
            var big = [CChar](repeating: 0, count: Int(-n))
            let n2 = llama_token_to_piece(vocab, token, &big, Int32(big.count), 0, false)
            return Array(big[0..<Int(max(n2, 0))])
        }
        return Array(buf[0..<Int(n)])
    }
}
