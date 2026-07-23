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

    // One in-flight generation at a time (mirrors LlamaPlugin's busy discipline).
    private var chatTask: Task<Void, Never>?

    // MARK: - Capability

    @objc func isSupported(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else {
            return call.resolve(["supported": false, "reason": "platform"])
        }
        switch SystemLanguageModel.default.availability {
        case .available:
            // Apple on-device model context window; advertised like LlamaPlugin.isSupported.
            call.resolve(["supported": true, "contextSize": 4096])
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
            .map { ($0.role == "assistant" ? "Assistant:\n" : "User:\n") + $0.content }
            .joined(separator: "\n\n")

        let task = Task { [weak self] in
            defer { self?.chatTask = nil }
            do {
                let session = LanguageModelSession(instructions: instructions.isEmpty ? nil : instructions)
                let options = GenerationOptions(temperature: temperature, maximumResponseTokens: maxTokens)
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

    @objc func cancelChat(_ call: CAPPluginCall) {
        chatTask?.cancel()
        call.resolve()
    }
}
