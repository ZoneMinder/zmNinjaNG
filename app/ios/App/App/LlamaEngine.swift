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

    private init() {}

    // MARK: Lifecycle

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
        if let m = model {
            llama_model_free(m)
            model = nil
            loadedModelId = nil
        }
    }

    // MARK: Chat

    func chat(modelId: String, modelPath: String, messagesJson: String,
              temperature: Double, maxTokens: Int, contextSize: Int) throws -> LlamaChatResult {
        // Serial guard: reject a second concurrent chat cleanly.
        lock.lock()
        if busy { lock.unlock(); throw LlamaEngineError.busy }
        busy = true
        cancelRequested = false
        if !backendReady { llama_backend_init(); backendReady = true }
        lock.unlock()
        defer { lock.lock(); busy = false; lock.unlock() }

        let model = try ensureModel(modelId: modelId, modelPath: modelPath)
        let vocab = llama_model_get_vocab(model)

        let prompt = try applyTemplate(model: model, messagesJson: messagesJson)

        // Context sized by the caller.
        var cparams = llama_context_default_params()
        cparams.n_ctx = UInt32(max(256, contextSize))
        let nThreads = Int32(max(1, min(8, ProcessInfo.processInfo.processorCount - 2)))
        cparams.n_threads = nThreads
        cparams.n_threads_batch = nThreads
        guard let ctx = llama_init_from_model(model, cparams) else { throw LlamaEngineError.contextInitFailed }
        defer { llama_free(ctx) }

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
        guard !promptTokens.isEmpty, promptTokens.count < nCtx else { throw LlamaEngineError.promptTooLong }

        var batch = llama_batch_init(Int32(max(promptTokens.count, 1)), 0, 1)
        defer { llama_batch_free(batch) }

        batchClear(&batch)
        for (i, tok) in promptTokens.enumerated() {
            batchAdd(&batch, tok, llama_pos(i), [0], false)
        }
        batch.logits[Int(batch.n_tokens) - 1] = 1 // sample from the last prompt token
        guard llama_decode(ctx, batch) == 0 else { throw LlamaEngineError.contextInitFailed }

        // Generation loop.
        var pieces: [CChar] = []
        var completion = 0
        var nCur = llama_pos(promptTokens.count)
        while completion < maxTokens && nCur < llama_pos(nCtx) {
            lock.lock(); let cancelled = cancelRequested; lock.unlock()
            if cancelled { throw LlamaEngineError.cancelled }

            let newToken = llama_sampler_sample(smpl, ctx, -1)
            if llama_vocab_is_eog(vocab, newToken) { break }

            pieces.append(contentsOf: tokenToPiece(vocab: vocab, token: newToken))
            completion += 1

            batchClear(&batch)
            batchAdd(&batch, newToken, nCur, [0], true)
            nCur += 1
            if llama_decode(ctx, batch) != 0 { break }
        }

        let content = String(cString: pieces + [0])
        return LlamaChatResult(content: content, promptTokens: promptTokens.count, completionTokens: completion)
    }

    // MARK: Helpers

    private func ensureModel(modelId: String, modelPath: String) throws -> OpaquePointer {
        if loadedModelId == modelId, let m = model { return m }
        freeModelLocked()
        var mparams = llama_model_default_params()
        #if targetEnvironment(simulator)
        mparams.n_gpu_layers = 0
        #else
        mparams.n_gpu_layers = 99
        #endif
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
