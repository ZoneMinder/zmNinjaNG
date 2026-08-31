import Foundation

/// The boundary between the app and llama.cpp.
///
/// llama.cpp's xcframework is built for a newer iOS than the app's own
/// deployment target, and it binds Accelerate symbols that do not exist on the
/// older systems in that gap. Anything the app links is bound by dyld at
/// launch, so the engine cannot live in the app binary: it lives in
/// LlamaBridge.framework, which the app embeds but never links, and loads by
/// hand once it knows the OS is new enough (issue #421).
///
/// This protocol has its own framework, linked by both the app and the bridge,
/// because an @objc protocol compiled into two binaries is two distinct
/// protocols to the ObjC runtime: the conformance the bridge registers is
/// invisible to the app's copy and every `as?` cast fails. One definition, one
/// Protocol object. Nothing here may reference llama - the app links this at
/// launch, which is exactly what llama cannot survive.
@objc public protocol LlamaEngineBridging {
    @objc var isBusy: Bool { get }
    @objc func cancelChat()
    @objc func unload()
    @objc func unloadIfLoaded(modelId: String)
    @objc func freeContextUnderPressure()
    /// Returns ["content": String, "promptTokens": Int, "completionTokens": Int].
    /// Throws an NSError in `LlamaEngineBridgingErrorDomain`; `busy` is the one
    /// code callers distinguish, so a second chat can be rejected as CHAT_BUSY.
    @objc func chat(
        modelId: String,
        modelPath: String,
        messagesJson: String,
        temperature: Double,
        maxTokens: Int,
        contextSize: Int,
        cacheSlot: Int,
        onStatus: @escaping (String, Double, Int, Int, Int, Int) -> Void
    ) throws -> [String: Any]
}

public let LlamaEngineBridgingErrorDomain = "LlamaEngineBridging"
/// NSError code for "a chat is already running". Every other failure is generic.
public let LlamaEngineBridgingBusyCode = 1
