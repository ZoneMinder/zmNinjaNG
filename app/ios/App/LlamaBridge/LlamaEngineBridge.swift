import Foundation
import LlamaBridgeInterface

/// Concrete `LlamaEngineBridging`, and the only class the app looks up by name
/// (`NSClassFromString("LlamaBridge.LlamaEngineBridge")`). Keep the module and
/// class names in step with `LlamaPlugin.bridgeClassName`.
///
/// Everything llama-typed stays behind this wall: the app never imports
/// LlamaKit, so nothing in the app binary references a symbol from a framework
/// that cannot load on an older OS.
@objc(LlamaEngineBridge)
public final class LlamaEngineBridge: NSObject, LlamaEngineBridging {
    @objc public var isBusy: Bool { LlamaEngine.shared.isBusy }

    @objc public func cancelChat() { LlamaEngine.shared.cancelChat() }

    @objc public func unload() { LlamaEngine.shared.unload() }

    @objc public func unloadIfLoaded(modelId: String) {
        LlamaEngine.shared.unloadIfLoaded(modelId: modelId)
    }

    @objc public func freeContextUnderPressure() {
        LlamaEngine.shared.freeContextUnderPressure()
    }

    @objc public func chat(
        modelId: String,
        modelPath: String,
        messagesJson: String,
        temperature: Double,
        maxTokens: Int,
        contextSize: Int,
        cacheSlot: Int,
        onStatus: @escaping (String, Double, Int, Int, Int, Int) -> Void
    ) throws -> [String: Any] {
        do {
            let result = try LlamaEngine.shared.chat(
                modelId: modelId, modelPath: modelPath, messagesJson: messagesJson,
                temperature: temperature, maxTokens: maxTokens, contextSize: contextSize,
                cacheSlot: cacheSlot, onStatus: onStatus)
            return [
                "content": result.content,
                "promptTokens": result.promptTokens,
                "completionTokens": result.completionTokens,
            ]
        } catch {
            // LlamaEngineError does not cross the @objc boundary; busy is the
            // one case the plugin branches on, so it keeps a dedicated code.
            let isBusyError: Bool
            if case LlamaEngineError.busy = error { isBusyError = true } else { isBusyError = false }
            throw NSError(
                domain: LlamaEngineBridgingErrorDomain,
                code: isBusyError ? LlamaEngineBridgingBusyCode : 0,
                userInfo: [NSLocalizedDescriptionKey: error.localizedDescription])
        }
    }
}
