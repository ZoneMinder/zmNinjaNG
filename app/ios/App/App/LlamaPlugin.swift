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
        LlamaEngine.shared.freeContextUnderPressure()
    }

    // MARK: - Capability

    @objc func isSupported(_ call: CAPPluginCall) {
        if ProcessInfo.processInfo.physicalMemory < LlamaPlugin.memoryFloor {
            call.resolve(["supported": false, "reason": "memory"])
        } else {
            call.resolve(["supported": true])
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
        let contextSize = call.getInt("contextSize") ?? 2048

        guard let url = try? modelURL(modelId), FileManager.default.fileExists(atPath: url.path) else {
            return call.reject("Model is not downloaded", "MODEL_NOT_DOWNLOADED")
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let result = try LlamaEngine.shared.chat(
                    modelId: modelId, modelPath: url.path, messagesJson: messagesJson,
                    temperature: temperature, maxTokens: maxTokens, contextSize: contextSize,
                    onStatus: { [weak self] phase, progress, tokens, cached in
                        self?.notifyListeners("chatStatus", data: [
                            "phase": phase, "progress": progress, "tokens": tokens, "cached": cached,
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
        LlamaEngine.shared.cancelChat()
        call.resolve()
    }

    @objc func unload(_ call: CAPPluginCall) {
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
