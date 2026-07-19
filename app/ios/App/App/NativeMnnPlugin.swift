import Capacitor
import CryptoKit
import Foundation

@objc(NativeMnnPlugin)
public class NativeMnnPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeMnnPlugin"
    public let jsName = "NativeMnn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isDownloaded", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getModelSize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "chat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unload", returnType: CAPPluginReturnPromise),
    ]

    /// Guarded by `downloadLock`: written from the JS thread by
    /// `cancelDownload`, read from the detached download task. A 1.4GB model is
    /// a long, cancellable operation.
    private let downloadLock = NSLock()
    private var downloadCancelled = false
    private var activeSession: URLSession?

    private func setActiveSession(_ session: URLSession?) {
        downloadLock.lock(); defer { downloadLock.unlock() }
        activeSession = session
    }

    private var isDownloadCancelled: Bool {
        downloadLock.lock(); defer { downloadLock.unlock() }
        return downloadCancelled
    }

    @objc func isDownloaded(_ call: CAPPluginCall) {
        guard let directory = modelDirectory(call) else { call.reject("Unsupported native MNN model"); return }
        call.resolve(["downloaded": FileManager.default.fileExists(atPath: directory.appendingPathComponent(".complete").path)])
    }

    @objc func deleteModel(_ call: CAPPluginCall) {
        guard let directory = modelDirectory(call) else { call.reject("Unsupported native MNN model"); return }
        NativeMnnBridge.unload()
        try? FileManager.default.removeItem(at: directory)
        call.resolve()
    }

    @objc func download(_ call: CAPPluginCall) {
        let modelId = call.getString("modelId", "")
        guard let directory = modelDirectory(call), let spec = ModelSpec.forId(modelId) else { call.reject("Unsupported native MNN model"); return }
        downloadLock.lock(); downloadCancelled = false; downloadLock.unlock()
        Task.detached {
            do {
                try? FileManager.default.removeItem(at: directory)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                for (index, file) in spec.files.enumerated() {
                    if self.isDownloadCancelled { throw DownloadError.cancelled }
                    try await self.downloadFile(spec: spec, file: file, directory: directory) { written, expected in
                        guard expected > 0 else { return }
                        self.notifyListeners("downloadProgress", data: [
                            "modelId": modelId,
                            "fileName": file.name,
                            "fileIndex": index + 1,
                            "fileCount": spec.files.count,
                            "fileProgress": Int(written * 100 / expected),
                            "fileBytesWritten": written,
                            "fileBytesTotal": expected,
                        ])
                    }
                }
                try Data().write(to: directory.appendingPathComponent(".complete"))
                self.setActiveSession(nil)
                call.resolve()
            } catch {
                self.setActiveSession(nil)
                try? FileManager.default.removeItem(at: directory)
                call.reject("Native MNN download failed: \(error.localizedDescription)")
            }
        }
    }

    /// Cancels the in-flight URLSession; the download's catch block deletes the
    /// partial directory.
    @objc func cancelDownload(_ call: CAPPluginCall) {
        downloadLock.lock()
        downloadCancelled = true
        let session = activeSession
        downloadLock.unlock()
        session?.invalidateAndCancel()
        call.resolve()
    }

    @objc func getModelSize(_ call: CAPPluginCall) {
        guard let directory = modelDirectory(call) else { call.reject("Unsupported native MNN model"); return }
        let files = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: [.fileSizeKey])
        var bytes = 0
        while let url = files?.nextObject() as? URL {
            bytes += ((try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize) ?? 0
        }
        call.resolve(["bytes": bytes])
    }

    /// Dispatched off the caller's thread: on-device generation takes seconds
    /// and this used to block the UI thread.
    @objc func chat(_ call: CAPPluginCall) {
        guard let directory = modelDirectory(call), FileManager.default.fileExists(atPath: directory.appendingPathComponent(".complete").path) else { call.reject("Native MNN model is not downloaded."); return }
        let messages = (call.getArray("messages") as? [[String: Any]] ?? []).map { message in
            ["role": message["role"] as? String ?? "user", "content": message["content"] as? String ?? ""]
        }
        guard !messages.isEmpty else { call.reject("Native MNN chat requires at least one message."); return }
        let maxTokens = call.getInt("maxTokens", 1024)
        let useGpu = call.getBool("useGpu", false)
        let configPath = directory.appendingPathComponent("config.json").path
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                // MNN's own token counts come back alongside the text, so the
                // app measures real context usage rather than estimating it.
                let response = try NativeMnnBridge.chat(atConfigPath: configPath, messages: messages, maxTokens: maxTokens, useGpu: useGpu)
                call.resolve([
                    "content": response["content"] as? String ?? "",
                    "promptTokens": response["promptTokens"] as? Int ?? 0,
                    "completionTokens": response["completionTokens"] as? Int ?? 0,
                ])
            } catch { call.reject(error.localizedDescription) }
        }
    }

    /// Loads the model without generating, so the UI can tell the user why the
    /// first turn is slow. Folded into chat(), a 10s load looked like a hang.
    @objc func load(_ call: CAPPluginCall) {
        guard let directory = modelDirectory(call), FileManager.default.fileExists(atPath: directory.appendingPathComponent(".complete").path) else { call.reject("Native MNN model is not downloaded."); return }
        let configPath = directory.appendingPathComponent("config.json").path
        let useGpu = call.getBool("useGpu", false)
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let backend = try NativeMnnBridge.load(atConfigPath: configPath, useGpu: useGpu)
                call.resolve(["backend": backend])
            } catch { call.reject(error.localizedDescription) }
        }
    }

    @objc func unload(_ call: CAPPluginCall) { NativeMnnBridge.unload(); call.resolve() }

    private func modelDirectory(_ call: CAPPluginCall) -> URL? {
        guard call.getString("modelId", "") == "Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN" else { return nil }
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("mnn").appendingPathComponent(call.getString("modelId", ""))
    }

    private func downloadFile(
        spec: ModelSpec,
        file: ModelFile,
        directory: URL,
        reportProgress: @escaping (Int64, Int64) -> Void,
    ) async throws {
        let url = URL(string: "https://huggingface.co/\(spec.repository)/resolve/\(spec.revision)/\(file.name)")!
        let partial = directory.appendingPathComponent(file.name + ".part")
        let delegate = DownloadDelegate(destination: partial, reportProgress: reportProgress)
        let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
        setActiveSession(session)
        let response = try await delegate.download(from: url, session: session)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { throw DownloadError.invalidResponse }
        let target = directory.appendingPathComponent(file.name)
        guard try Self.sha256(partial) == file.sha256 else { throw DownloadError.checksum(file.name) }
        try FileManager.default.moveItem(at: partial, to: target)
    }

    private static func sha256(_ file: URL) throws -> String {
        let input = try FileHandle(forReadingFrom: file)
        defer { try? input.close() }
        var digest = SHA256()
        while let bytes = try input.read(upToCount: 8192), !bytes.isEmpty { digest.update(data: bytes) }
        return digest.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private enum DownloadError: LocalizedError {
        case invalidResponse
        case checksum(String)
        case cancelled

        var errorDescription: String? {
            switch self {
            case .invalidResponse: return "Invalid download response"
            case .checksum(let file): return "Checksum failed for \(file)"
            case .cancelled: return "Cancelled"
            }
        }
    }

    private final class DownloadDelegate: NSObject, URLSessionDownloadDelegate {
        private let destination: URL
        private let reportProgress: (Int64, Int64) -> Void
        private var continuation: CheckedContinuation<URLResponse, Error>?
        private var response: URLResponse?
        private var downloadError: Error?
        private var lastProgress = -1

        init(destination: URL, reportProgress: @escaping (Int64, Int64) -> Void) {
            self.destination = destination
            self.reportProgress = reportProgress
        }

        func download(from url: URL, session: URLSession) async throws -> URLResponse {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                session.downloadTask(with: url).resume()
            }
        }

        func urlSession(
            _ session: URLSession,
            downloadTask: URLSessionDownloadTask,
            didWriteData bytesWritten: Int64,
            totalBytesWritten: Int64,
            totalBytesExpectedToWrite: Int64,
        ) {
            guard totalBytesExpectedToWrite > 0 else { return }
            let progress = Int(totalBytesWritten * 100 / totalBytesExpectedToWrite)
            guard progress != lastProgress else { return }
            lastProgress = progress
            reportProgress(totalBytesWritten, totalBytesExpectedToWrite)
        }

        func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
            do {
                try FileManager.default.copyItem(at: location, to: destination)
                response = downloadTask.response
            } catch {
                downloadError = error
            }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            defer { continuation = nil }
            if let error { continuation?.resume(throwing: error); return }
            if let downloadError { continuation?.resume(throwing: downloadError); return }
            guard let response else {
                continuation?.resume(throwing: DownloadError.invalidResponse)
                return
            }
            continuation?.resume(returning: response)
        }
    }

    private struct ModelFile {
        let name: String
        let sha256: String
    }

    private struct ModelSpec {
        let repository: String
        let revision: String
        let files: [ModelFile]

        static func forId(_ id: String) -> ModelSpec? {
            switch id {
            case "Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN":
                return ModelSpec(repository: "taobao-mnn/Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN", revision: "3ebd7e8f68fc0d03b107a6a0828889d646f4a5db", files: [
                    ModelFile(name: "config.json", sha256: "92853033efe602f95efca3e1c05cd8b108f973c8beed417843a9671f8147ed8d"),
                    ModelFile(name: "llm.mnn", sha256: "aac90290bde6d7746b0df08f06582a6004747c0c3ab5760ce652a6eaad6d2d61"),
                    ModelFile(name: "llm.mnn.json", sha256: "7a26766882e7ab40570a1af7eb6090408e21b4cdd59fbe448cef47d3b6a28059"),
                    ModelFile(name: "llm.mnn.weight", sha256: "e01b6e410837fee107466a228717b0e06e8d0b62398c3540bfdd4994977896ba"),
                    ModelFile(name: "llm_config.json", sha256: "ba0b3ec3d7eb600f4cfbac62d765f0e4427bef79c15b9fda9e45649a3b16c167"),
                    ModelFile(name: "tokenizer.txt", sha256: "3f1f5a131d209db739382cd25cf5cc0b2769c87503878a12e4f3a1ed4ca2311c"),
                    ModelFile(name: "visual.mnn", sha256: "433014df11d78b53092dc32d8e143d22d321386eb71c9b07847720e94d3407f5"),
                    ModelFile(name: "visual.mnn.weight", sha256: "8f90e106f5b9ae9a939faed240305cfdd5c6740ae91d3fc418a990bee0cce36b"),
                ])
            default: return nil
            }
        }
    }
}
