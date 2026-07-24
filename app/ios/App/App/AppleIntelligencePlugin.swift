import Foundation
import Capacitor
import FoundationModels

/// Native LLM plugin backed by Apple Foundation Models (iOS 26 on-device system model).
/// JS contract mirrors the NativeLlm plugin's chat surface; no model download/management here
/// because the system model ships with the OS.
@objc(AppleIntelligencePlugin)
public class AppleIntelligencePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleIntelligencePlugin"
    public let jsName = "AppleIntelligence"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "chat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelChat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resolveToolCall", returnType: CAPPluginReturnPromise),
    ]

    private struct ChatMessage: Decodable {
        let role: String
        let content: String
    }

    /// One entry of the `toolsJson` array: the JS-side tool catalog.
    private struct ToolSpec: Decodable {
        let name: String
        let description: String
        let schemaJson: String?
    }

    // Apple's on-device model context window, and the slice of it reserved for the reply.
    private static let contextWindow = 4096
    private static let responseReserve = 1024

    // One in-flight generation at a time (mirrors LlamaPlugin's busy discipline).
    private var chatTask: Task<Void, Never>?

    // Held so the prewarmed session (and the assets it loaded) outlives isSupported.
    // Typed AnyObject because stored properties cannot carry @available.
    private var prewarmSession: AnyObject?

    // Native tool calls parked mid-generation while JS executes them.
    private let toolCalls = ToolCallRegistry()

    // How long a bridged tool call may wait on JS before it is failed.
    private static let toolCallTimeout: UInt64 = 120_000_000_000

    // MARK: - Capability

    @objc func isSupported(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else {
            return call.resolve(["supported": false, "reason": "platform"])
        }
        switch SystemLanguageModel.default.availability {
        case .available:
            // Eagerly load model resources so the first real turn does not pay that latency.
            let session = LanguageModelSession()
            session.prewarm()
            prewarmSession = session
            // Advertised like LlamaPlugin.isSupported, but the USABLE window, not the raw one:
            // mirrors LlamaPlugin's triageReserve pattern. The JS auto-clear budget must leave
            // decoder headroom, or constrained generation truncates at the window edge and
            // deserialization fails ("Failed to deserialize a Generable type from model
            // output", refs #270).
            call.resolve(["supported": true, "contextSize": Self.contextWindow - Self.responseReserve])
        case .unavailable(let reason):
            let mapped: String
            switch reason {
            case .deviceNotEligible: mapped = "platform"
            case .appleIntelligenceNotEnabled: mapped = "disabled"
            case .modelNotReady: mapped = "notReady"
            @unknown default: mapped = "platform"
            }
            call.resolve(["supported": false, "reason": mapped])
        }
    }

    // MARK: - Inference

    @objc func chat(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else {
            return call.reject("Apple Intelligence requires iOS 26", "ENGINE_FAILED")
        }
        guard let messagesJson = call.getString("messagesJson") else {
            return call.reject("messagesJson is required")
        }
        if chatTask != nil {
            return call.reject("A chat is already running", "CHAT_BUSY")
        }
        let temperature = call.getDouble("temperature") ?? 0
        let maxTokens = call.getInt("maxTokens") ?? 512

        guard let data = messagesJson.data(using: .utf8),
              let messages = try? JSONDecoder().decode([ChatMessage].self, from: data) else {
            return call.reject("messagesJson is invalid")
        }

        // Role-typed multiturn history. The last user message is not part of the history:
        // it is the prompt this turn responds to.
        let conversation = messages.filter { $0.role != "system" }
        guard let lastUserIndex = conversation.lastIndex(where: { $0.role == "user" }) else {
            return call.reject("messagesJson has no user message")
        }
        let prompt = conversation[lastUserIndex].content

        let systemText = messages
            .filter { $0.role == "system" }
            .map { $0.content }
            .joined(separator: "\n\n")

        var entries: [Transcript.Entry] = []
        if !systemText.isEmpty {
            entries.append(.instructions(Transcript.Instructions(
                segments: [.text(Transcript.TextSegment(content: systemText))],
                toolDefinitions: []
            )))
        }
        for message in conversation[..<lastUserIndex] {
            let segments: [Transcript.Segment] = [.text(Transcript.TextSegment(content: message.content))]
            entries.append(message.role == "assistant"
                ? .response(Transcript.Response(assetIDs: [], segments: segments))
                : .prompt(Transcript.Prompt(segments: segments)))
        }
        let history = entries

        let schemaJson = call.getString("schemaJson")
        let toolsJson = call.getString("toolsJson")

        let task = Task { [weak self] in
            defer { self?.chatTask = nil }
            do {
                // Native tool calling: the model picks and fills the tool, we bridge execution to JS.
                let tools = self?.buildTools(fromToolsJson: toolsJson) ?? []

                let session = tools.isEmpty
                    ? LanguageModelSession(transcript: Transcript(entries: history))
                    : LanguageModelSession(tools: tools, transcript: Transcript(entries: history))
                let options = GenerationOptions(temperature: temperature, maximumResponseTokens: maxTokens)

                // Schema-constrained (guided) generation when the caller supplies a JSON Schema.
                // A bad/unbuildable schema falls back to unconstrained generation; it never fails the chat.
                // Never combined with native tools: with tools the reply is prose, not a shaped object.
                var generationSchema: GenerationSchema?
                if tools.isEmpty,
                   let schemaJson,
                   let schemaData = schemaJson.data(using: .utf8),
                   let schemaRoot = (try? JSONSerialization.jsonObject(with: schemaData)) as? [String: Any] {
                    generationSchema = self?.buildGenerationSchema(fromJsonSchema: schemaRoot)
                }

                let content: String
                if let generationSchema {
                    // includeSchemaInPrompt defaults to true, which injects the full schema text
                    // into the prompt ON TOP of the tool catalog the JS layer already sends; on the
                    // 4096-token window that overflowed on the FIRST turn of a fresh conversation
                    // (refs #270). The decoder constraint alone is what we want.
                    let response = try await session.respond(to: prompt, schema: generationSchema, includeSchemaInPrompt: false, options: options)
                    content = response.content.jsonString
                } else {
                    let response = try await session.respond(to: prompt, options: options)
                    content = response.content
                }

                var result: [String: Any] = ["content": content]
                // Exact counts from the tokenizer (iOS 26.4+). If unavailable or the count
                // throws, omit the keys: JS reads absent as unknown rather than trusting an
                // estimate.
                if #available(iOS 26.4, *),
                   let usage = try? await Self.tokenUsage(
                       history: history,
                       prompt: prompt,
                       schema: generationSchema,
                       content: content
                   ) {
                    result["promptTokens"] = usage.prompt
                    result["completionTokens"] = usage.completion
                }
                call.resolve(result)
            } catch is CancellationError {
                call.reject("Cancelled", "CANCELLED")
            } catch let error as LanguageModelSession.GenerationError {
                if case .exceededContextWindowSize = error {
                    call.reject(error.localizedDescription, "CONTEXT_FULL")
                } else {
                    // Guardrail violation and the rest.
                    call.reject(error.localizedDescription, "ENGINE_FAILED")
                }
            } catch {
                call.reject(error.localizedDescription, "ENGINE_FAILED")
            }
        }
        chatTask = task
    }

    /// Exact prompt/completion token counts for one turn, from the model's tokenizer.
    @available(iOS 26.4, *)
    private static func tokenUsage(
        history: [Transcript.Entry],
        prompt: String,
        schema: GenerationSchema?,
        content: String
    ) async throws -> (prompt: Int, completion: Int) {
        let model = SystemLanguageModel.default
        var promptTokens = history.isEmpty ? 0 : try await model.tokenCount(for: history)
        promptTokens += try await model.tokenCount(for: prompt)
        if let schema {
            promptTokens += try await model.tokenCount(for: schema)
        }
        let completionTokens = try await model.tokenCount(for: content)
        return (promptTokens, completionTokens)
    }

    // MARK: - Native tool calling

    /// Turn the JS tool catalog into FoundationModels tools whose execution bridges back to JS.
    /// Returns [] when the caller sent no tools, or the JSON is unusable.
    @available(iOS 26.0, *)
    private func buildTools(fromToolsJson toolsJson: String?) -> [any Tool] {
        guard let toolsJson,
              let data = toolsJson.data(using: .utf8),
              let specs = try? JSONDecoder().decode([ToolSpec].self, from: data),
              !specs.isEmpty else {
            return []
        }
        return specs.compactMap { spec -> (any Tool)? in
            // A tool with no argument schema still has to expose one, so it degrades to an empty
            // object: the model can call it, just without arguments. An unbuildable schema drops
            // the tool rather than offering the model something it cannot fill.
            var root = DynamicGenerationSchema(name: spec.name, description: spec.description, properties: [])
            if let schemaJson = spec.schemaJson,
               let schemaData = schemaJson.data(using: .utf8),
               let schemaRoot = (try? JSONSerialization.jsonObject(with: schemaData)) as? [String: Any] {
                root = dynamicSchema(fromJsonSchema: schemaRoot, name: spec.name)
            }
            guard let parameters = try? GenerationSchema(root: root, dependencies: []) else {
                CAPLog.print("[AppleIntelligence] tool schema build failed; dropping tool \(spec.name)")
                return nil
            }
            return BridgedTool(
                name: spec.name,
                description: spec.description,
                parameters: parameters,
                invoke: { [weak self] name, argumentsJson in
                    guard let self else { throw CancellationError() }
                    return try await self.runBridgedToolCall(name: name, argumentsJson: argumentsJson)
                }
            )
        }
    }

    /// Emit a `toolCall` event and suspend until JS calls `resolveToolCall` (or the timeout fires).
    private func runBridgedToolCall(name: String, argumentsJson: String) async throws -> String {
        let callId = UUID().uuidString
        let registry = toolCalls
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
            Task { [weak self] in
                await registry.register(callId, continuation)
                self?.notifyListeners("toolCall", data: [
                    "callId": callId,
                    "name": name,
                    "argumentsJson": argumentsJson,
                ])
                try? await Task.sleep(nanoseconds: Self.toolCallTimeout)
                await registry.resume(callId, with: .failure(ToolBridgeError.timedOut(name)))
            }
        }
    }

    /// JS hands back the tool's output. An unknown callId is a late resolution after a timeout or
    /// cancel, so it resolves silently instead of erroring.
    @objc func resolveToolCall(_ call: CAPPluginCall) {
        guard let callId = call.getString("callId") else {
            return call.reject("callId is required")
        }
        let output = call.getString("output") ?? ""
        let registry = toolCalls
        Task {
            await registry.resume(callId, with: .success(output))
            call.resolve()
        }
    }

    // MARK: - Guided generation schema

    /// Build a `GenerationSchema` from a JSON Schema subset. Returns nil (caller falls back to
    /// unconstrained generation) if construction throws.
    @available(iOS 26.0, *)
    private func buildGenerationSchema(fromJsonSchema json: [String: Any]) -> GenerationSchema? {
        let root = dynamicSchema(fromJsonSchema: json, name: "Turn")
        if let schema = try? GenerationSchema(root: root, dependencies: []) {
            return schema
        }
        CAPLog.print("[AppleIntelligence] guided schema build failed; falling back to unconstrained")
        return nil
    }

    /// Recursively convert a JSON Schema subset into a `DynamicGenerationSchema`.
    /// Unknown/unsupported shapes degrade to a String primitive so this never crashes.
    @available(iOS 26.0, *)
    private func dynamicSchema(fromJsonSchema json: [String: Any], name: String) -> DynamicGenerationSchema {
        let description = json["description"] as? String

        // String enum -> anyOf choices [String]
        if let choices = json["enum"] as? [String] {
            return DynamicGenerationSchema(name: name, description: description, anyOf: choices)
        }

        // Top-level anyOf -> anyOf choices [DynamicGenerationSchema]
        if let anyOf = json["anyOf"] as? [[String: Any]] {
            let choices = anyOf.enumerated().map { index, sub in
                dynamicSchema(fromJsonSchema: sub, name: "\(name)_\(index)")
            }
            return DynamicGenerationSchema(name: name, description: description, anyOf: choices)
        }

        switch json["type"] as? String {
        case "string":
            return DynamicGenerationSchema(type: String.self)
        case "number":
            return DynamicGenerationSchema(type: Double.self)
        case "integer":
            return DynamicGenerationSchema(type: Int.self)
        case "boolean":
            return DynamicGenerationSchema(type: Bool.self)
        case "array":
            let items = json["items"] as? [String: Any] ?? [:]
            let element = dynamicSchema(fromJsonSchema: items, name: "\(name)_item")
            return DynamicGenerationSchema(arrayOf: element)
        case "object":
            let properties = json["properties"] as? [String: Any] ?? [:]
            let required = Set(json["required"] as? [String] ?? [])
            let props: [DynamicGenerationSchema.Property] = properties.map { key, value in
                let propJson = value as? [String: Any] ?? [:]
                let propSchema = dynamicSchema(fromJsonSchema: propJson, name: "\(name)_\(key)")
                return DynamicGenerationSchema.Property(
                    name: key,
                    description: propJson["description"] as? String,
                    schema: propSchema,
                    isOptional: !required.contains(key)
                )
            }
            return DynamicGenerationSchema(name: name, description: description, properties: props)
        default:
            // Unknown/missing type -> String primitive; never crash.
            return DynamicGenerationSchema(type: String.self)
        }
    }

    @objc func cancelChat(_ call: CAPPluginCall) {
        chatTask?.cancel()
        // A generation parked on a bridged tool call is not cancellable through the task alone:
        // fail the pending calls too, or the bridge hangs until the timeout.
        let registry = toolCalls
        Task {
            await registry.failAll(CancellationError())
            call.resolve()
        }
    }
}

// MARK: - Tool bridge

private enum ToolBridgeError: LocalizedError {
    case timedOut(String)

    var errorDescription: String? {
        switch self {
        case .timedOut(let name): return "Tool \(name) did not respond in time"
        }
    }
}

/// Continuations for tool calls the model started and JS has not answered yet.
private actor ToolCallRegistry {
    private var pending: [String: CheckedContinuation<String, Error>] = [:]

    func register(_ callId: String, _ continuation: CheckedContinuation<String, Error>) {
        pending[callId] = continuation
    }

    /// No-op when the call is already settled (late resolve, or a resolve after timeout/cancel).
    func resume(_ callId: String, with result: Result<String, Error>) {
        pending.removeValue(forKey: callId)?.resume(with: result)
    }

    func failAll(_ error: Error) {
        let outstanding = pending.values
        pending.removeAll()
        for continuation in outstanding { continuation.resume(throwing: error) }
    }
}

/// A FoundationModels tool whose body is executed by the JS layer over the Capacitor bridge.
@available(iOS 26.0, *)
private struct BridgedTool: Tool {
    typealias Arguments = GeneratedContent
    typealias Output = String

    let name: String
    let description: String
    let parameters: GenerationSchema
    let invoke: @Sendable (String, String) async throws -> String

    func call(arguments: GeneratedContent) async throws -> String {
        try await invoke(name, arguments.jsonString)
    }
}
