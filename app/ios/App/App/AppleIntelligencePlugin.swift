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
    ]

    private struct ChatMessage: Decodable {
        let role: String
        let content: String
    }

    // Model-facing role markers for the flattened transcript.
    private static let assistantRolePrefix = "Assistant:\n"
    private static let userRolePrefix = "User:\n"

    // Apple's on-device model context window, and the slice of it reserved for the reply.
    private static let contextWindow = 4096
    private static let responseReserve = 1024

    // One in-flight generation at a time (mirrors LlamaPlugin's busy discipline).
    private var chatTask: Task<Void, Never>?

    // MARK: - Capability

    @objc func isSupported(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else {
            return call.resolve(["supported": false, "reason": "platform"])
        }
        switch SystemLanguageModel.default.availability {
        case .available:
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

        // ponytail: flattened transcript; upgrade path = Transcript(entries:) role-typed history
        let instructions = messages
            .filter { $0.role == "system" }
            .map { $0.content }
            .joined(separator: "\n\n")
        let prompt = messages
            .filter { $0.role != "system" }
            .map { ($0.role == "assistant" ? Self.assistantRolePrefix : Self.userRolePrefix) + $0.content }
            .joined(separator: "\n\n")

        let schemaJson = call.getString("schemaJson")

        let task = Task { [weak self] in
            defer { self?.chatTask = nil }
            do {
                let session = LanguageModelSession(instructions: instructions.isEmpty ? nil : instructions)
                let options = GenerationOptions(temperature: temperature, maximumResponseTokens: maxTokens)

                // Schema-constrained (guided) generation when the caller supplies a JSON Schema.
                // A bad/unbuildable schema falls back to unconstrained generation; it never fails the chat.
                if let schemaJson,
                   let schemaData = schemaJson.data(using: .utf8),
                   let schemaRoot = (try? JSONSerialization.jsonObject(with: schemaData)) as? [String: Any],
                   let generationSchema = self?.buildGenerationSchema(fromJsonSchema: schemaRoot) {
                    // includeSchemaInPrompt defaults to true, which injects the full schema text
                    // into the prompt ON TOP of the tool catalog the JS layer already sends; on the
                    // 4096-token window that overflowed on the FIRST turn of a fresh conversation
                    // (refs #270). The decoder constraint alone is what we want.
                    let response = try await session.respond(to: prompt, schema: generationSchema, includeSchemaInPrompt: false, options: options)
                    call.resolve(["content": response.content.jsonString])
                    return
                }

                let response = try await session.respond(to: prompt, options: options)
                call.resolve(["content": response.content])
            } catch is CancellationError {
                call.reject("Cancelled", "CANCELLED")
            } catch {
                // Guardrail violation and other GenerationError land here.
                call.reject(error.localizedDescription, "ENGINE_FAILED")
            }
        }
        chatTask = task
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
        call.resolve()
    }
}
