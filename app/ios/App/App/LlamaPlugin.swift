import Foundation
import Capacitor
import UIKit

/// Native LLM plugin: downloads GGUF models and runs on-device inference via llama.cpp (Metal).
/// JS contract: app/src/plugins/native-llm/definitions.ts
@objc(LlamaPlugin)
public class LlamaPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDownloadDelegate {
    public let identifier = "LlamaPlugin"
    public let jsName = "NativeLlm"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isModelDownloaded", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "chat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelChat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unload", returnType: CAPPluginReturnPromise),
    ]

    // 5.5 GiB physical-memory floor for on-device inference.
    private static let memoryFloor: UInt64 = UInt64(5.5 * 1024 * 1024 * 1024)

    // llama.cpp publishes its xcframework built for iOS 16.4 (upstream's
    // build-xcframework.sh hardcodes that floor), above this app's own 16.0
    // deployment target, so llama.framework is weak-linked: on 16.0-16.3 dyld
    // skips it at launch instead of killing the process, and every symbol in it
    // is null. Nothing may reach LlamaEngine without this check (issue #421).
    static let minimumOS = "16.4"
    private var engineAvailable: Bool {
        if #available(iOS 16.4, *) { return true }
        return false
    }
    private func rejectUnavailable(_ call: CAPPluginCall) {
        call.reject("On-device models require iOS \(LlamaPlugin.minimumOS)", "OS_UNSUPPORTED")
    }

    private lazy var session: URLSession = {
        URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    }()
    private var downloadTask: URLSessionDownloadTask?
    private var downloadCall: CAPPluginCall?
    private var downloadModelId: String?

    // MARK: - Lifecycle

    override public func load() {
        // Memory valve: under pressure, free the persistent KV context (keep the model).
        // LlamaEngine defers the free if a chat is generating. Mirrors Android's onTrimMemory.
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleMemoryWarning),
            name: UIApplication.didReceiveMemoryWarningNotification, object: nil)
    }

    @objc private func handleMemoryWarning() {
        guard engineAvailable else { return }
        LlamaEngine.shared.freeContextUnderPressure()
    }

    // Triage runs in the second KV slot of the shared unified pool; reserve its cells from the
    // window advertised to JS so context auto-clear trims before cross-slot overflow.
    private static let triageReserve = 512

    /// Context window derived from physical RAM, not tuned for any one device: 8GB+ iPhones get
    /// 8192, 6GB (which pass the floor with the extended-memory entitlement) get 6144. Bigger
    /// n_ctx = bigger KV cache; too big OOM-kills mid-generation (refs #270).
    private func deviceContextSize() -> Int {
        ProcessInfo.processInfo.physicalMemory >= UInt64(8) * 1024 * 1024 * 1024 ? 8192 : 6144
    }

    // MARK: - Capability

    @objc func isSupported(_ call: CAPPluginCall) {
        if !engineAvailable {
            call.resolve(["supported": false, "reason": "os", "minimumOs": LlamaPlugin.minimumOS])
        } else if ProcessInfo.processInfo.physicalMemory < LlamaPlugin.memoryFloor {
            call.resolve(["supported": false, "reason": "memory"])
        } else {
            // Advertised chat window = device tier minus the triage reserve; the provider reports
            // it as contextWindow so JS auto-clear matches what the native pool can hold.
            call.resolve(["supported": true, "contextSize": deviceContextSize() - LlamaPlugin.triageReserve])
        }
    }

    // MARK: - Model files

    @objc func isModelDownloaded(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId") else { return call.reject("modelId is required") }
        guard let url = try? modelURL(modelId), FileManager.default.fileExists(atPath: url.path) else {
            return call.resolve(["downloaded": false])
        }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        call.resolve(["downloaded": true, "sizeBytes": size, "path": url.path])
    }

    @objc func deleteModel(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId") else { return call.reject("modelId is required") }
        // The file is the engine's, but it is still just a file: delete it even
        // where the engine cannot run, so a model downloaded before an OS
        // downgrade is not stranded on disk.
        guard engineAvailable else {
            if let url = try? modelURL(modelId) { try? FileManager.default.removeItem(at: url) }
            return call.resolve()
        }
        // Never free the model out from under a running chat (use-after-free).
        if LlamaEngine.shared.isBusy {
            return call.reject("A reply is being generated; try again when it finishes", "CHAT_BUSY")
        }
        LlamaEngine.shared.unloadIfLoaded(modelId: modelId)
        if let url = try? modelURL(modelId) {
            try? FileManager.default.removeItem(at: url)
        }
        call.resolve()
    }

    // MARK: - Download

    @objc func downloadModel(_ call: CAPPluginCall) {
        // No point spending gigabytes of the user's bandwidth on a model this
        // OS cannot load.
        guard engineAvailable else { return rejectUnavailable(call) }
        guard let modelId = call.getString("modelId") else { return call.reject("modelId is required") }
        guard let urlStr = call.getString("url"), let url = URL(string: urlStr) else {
            return call.reject("url is required")
        }
        if downloadTask != nil { return call.reject("A download is already in progress", "DOWNLOAD_IN_PROGRESS") }
        call.keepAlive = true
        downloadCall = call
        downloadModelId = modelId
        let task = session.downloadTask(with: url)
        downloadTask = task
        task.resume()
    }

    @objc func cancelDownload(_ call: CAPPluginCall) {
        downloadTask?.cancel()
        call.resolve()
    }

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                           didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                           totalBytesExpectedToWrite: Int64) {
        guard let modelId = downloadModelId else { return }
        notifyListeners("downloadProgress", data: [
            "modelId": modelId,
            "bytesDownloaded": totalBytesWritten,
            "totalBytes": totalBytesExpectedToWrite,
        ])
    }

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                           didFinishDownloadingTo location: URL) {
        // Must move the temp file synchronously here; it is deleted once this returns.
        guard let modelId = downloadModelId, let call = downloadCall else { return }
        do {
            var dest = try modelURL(modelId)
            let fm = FileManager.default
            if fm.fileExists(atPath: dest.path) { try fm.removeItem(at: dest) }
            try fm.moveItem(at: location, to: dest)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try dest.setResourceValues(values)
            call.resolve()
        } catch {
            call.reject("Failed to save model: \(error.localizedDescription)", "SAVE_FAILED")
        }
        clearDownload()
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error = error else { return } // success handled in didFinishDownloadingTo
        // URLSession owns and cleans its temp file; the final destination is only written
        // on success, so do not touch it here — a failed re-download must keep any prior model.
        downloadCall?.reject("Download failed: \(error.localizedDescription)", "DOWNLOAD_FAILED")
        clearDownload()
    }

    private func clearDownload() {
        downloadCall = nil
        downloadModelId = nil
        downloadTask = nil
    }

    // MARK: - Inference

    @objc func chat(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId") else { return call.reject("modelId is required") }
        guard let messagesJson = call.getString("messagesJson") else { return call.reject("messagesJson is required") }
        let temperature = call.getDouble("temperature") ?? 0
        let maxTokens = call.getInt("maxTokens") ?? 512
        // Cap the JS-requested window down to the device tier: native owns sizing (RAM-derived),
        // JS only asks for an upper bound. The full tier is created here (both slots share it);
        // only the isSupported-advertised window subtracts the triage reserve.
        let contextSize = min(call.getInt("contextSize") ?? 8192, deviceContextSize())
        let cacheSlot = call.getInt("cacheSlot") ?? 0 // 0 = chat, 1 = triage (separate KV sequences)

        guard engineAvailable else { return rejectUnavailable(call) }

        guard let url = try? modelURL(modelId), FileManager.default.fileExists(atPath: url.path) else {
            return call.reject("Model is not downloaded", "MODEL_NOT_DOWNLOADED")
        }

        DispatchQueue.global(qos: .userInitiated).async {
            // Keep the screen awake while generating (foreground-only) so the user watching the
            // status line isn't left on a sleeping screen. Only the call that actually owns
            // generation touches the flag: a concurrent, CHAT_BUSY-rejected call must not toggle
            // it (its defer would re-enable the idle timer while the first chat still runs).
            // Matches Android's gate-before-flag ordering.
            let ownsScreen = !LlamaEngine.shared.isBusy
            if ownsScreen { DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = true } }
            defer { if ownsScreen { DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = false } } }
            do {
                let result = try LlamaEngine.shared.chat(
                    modelId: modelId, modelPath: url.path, messagesJson: messagesJson,
                    temperature: temperature, maxTokens: maxTokens, contextSize: contextSize, cacheSlot: cacheSlot,
                    onStatus: { [weak self] phase, progress, tokens, cached, chunk, chunks in
                        self?.notifyListeners("chatStatus", data: [
                            "phase": phase, "progress": progress, "tokens": tokens, "cached": cached,
                            "chunk": chunk, "chunks": chunks, "slot": cacheSlot,
                        ])
                    })
                call.resolve([
                    "content": result.content,
                    "promptTokens": result.promptTokens,
                    "completionTokens": result.completionTokens,
                ])
            } catch LlamaEngineError.busy {
                call.reject(LlamaEngineError.busy.localizedDescription, "CHAT_BUSY")
            } catch {
                call.reject(error.localizedDescription, "ENGINE_FAILED")
            }
        }
    }

    @objc func cancelChat(_ call: CAPPluginCall) {
        guard engineAvailable else { return call.resolve() }
        LlamaEngine.shared.cancelChat()
        call.resolve()
    }

    @objc func unload(_ call: CAPPluginCall) {
        guard engineAvailable else { return call.resolve() }
        if LlamaEngine.shared.isBusy {
            return call.reject("A reply is being generated; try again when it finishes", "CHAT_BUSY")
        }
        LlamaEngine.shared.unload()
        call.resolve()
    }

    // MARK: - Paths

    private func modelsDir() throws -> URL {
        let base = try FileManager.default.url(for: .applicationSupportDirectory,
                                               in: .userDomainMask, appropriateFor: nil, create: true)
        let dir = base.appendingPathComponent("NativeLlm", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func modelURL(_ modelId: String) throws -> URL {
        // Sanitize: modelId becomes a filename, so strip anything that could escape the directory.
        let safe = modelId.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" || $0 == "." ? $0 : "_" }
        let name = String(safe)
        return try modelsDir().appendingPathComponent(name + ".gguf")
    }
}
