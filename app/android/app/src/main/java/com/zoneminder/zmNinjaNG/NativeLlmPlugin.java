package com.zoneminder.zmNinjaNG;

import android.app.ActivityManager;
import android.content.Context;
import android.os.PowerManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Native LLM plugin: downloads GGUF models and runs on-device inference via
 * llama.cpp (CPU). Java mirror of app/ios/App/App/LlamaPlugin.swift; the native
 * engine lives in cpp/llama_jni.cpp. JS contract: app/src/plugins/native-llm/definitions.ts.
 */
@CapacitorPlugin(name = "NativeLlm")
public class NativeLlmPlugin extends Plugin {

    static { System.loadLibrary("nativellm"); }

    // Inference (cpp/llama_jni.cpp). nativeChat fills outCounts = {promptTokens, completionTokens},
    // returns the raw UTF-8 completion bytes, and throws RuntimeException on engine failure.
    private static native byte[] nativeChat(String modelId, String modelPath, String libDir,
                                            String[] roles, String[] contents, double temperature,
                                            int maxTokens, int contextSize, int[] outCounts);
    private static native void nativeCancelChat();
    private static native void nativeUnload();
    private static native void nativeFreeIfLoaded(String modelId);

    // 5.5 GiB physical-memory floor for on-device inference (matches iOS).
    private static final long MEMORY_FLOOR = (long) (5.5 * 1024 * 1024 * 1024);

    // Serial chat guard: a second concurrent chat is rejected, never queued.
    private final ExecutorService chatExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean chatInFlight = new AtomicBoolean(false);

    // Download state.
    private final AtomicBoolean downloadInProgress = new AtomicBoolean(false);
    private volatile boolean downloadCanceled = false;
    private volatile HttpURLConnection activeConnection = null;

    // MARK: - Capability

    @PluginMethod
    public void isSupported(PluginCall call) {
        ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        am.getMemoryInfo(mi);
        boolean ok = mi.totalMem >= MEMORY_FLOOR && !am.isLowRamDevice();
        JSObject ret = new JSObject();
        ret.put("supported", ok);
        if (!ok) ret.put("reason", "memory");
        call.resolve(ret);
    }

    // MARK: - Model files

    @PluginMethod
    public void isModelDownloaded(PluginCall call) {
        String modelId = call.getString("modelId");
        if (modelId == null) { call.reject("modelId is required"); return; }
        File file = modelFile(modelId);
        JSObject ret = new JSObject();
        if (file.exists()) {
            ret.put("downloaded", true);
            ret.put("sizeBytes", file.length());
            ret.put("path", file.getAbsolutePath());
        } else {
            ret.put("downloaded", false);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void deleteModel(PluginCall call) {
        String modelId = call.getString("modelId");
        if (modelId == null) { call.reject("modelId is required"); return; }
        // Never free the model out from under a running chat (use-after-free).
        if (chatInFlight.get()) {
            call.reject("A reply is being generated; try again when it finishes", "CHAT_BUSY");
            return;
        }
        nativeFreeIfLoaded(modelId);
        File file = modelFile(modelId);
        if (file.exists()) file.delete();
        call.resolve();
    }

    // MARK: - Download

    @PluginMethod
    public void downloadModel(PluginCall call) {
        String modelId = call.getString("modelId");
        String urlStr = call.getString("url");
        if (modelId == null) { call.reject("modelId is required"); return; }
        if (urlStr == null || urlStr.isEmpty()) { call.reject("url is required"); return; }
        if (!downloadInProgress.compareAndSet(false, true)) {
            call.reject("A download is already in progress", "DOWNLOAD_IN_PROGRESS");
            return;
        }
        downloadCanceled = false;
        new Thread(() -> runDownload(call, modelId, urlStr)).start();
    }

    private void runDownload(PluginCall call, String modelId, String urlStr) {
        // Download to a temp file, atomic-rename on success. The final file is only
        // written on success, so a failed re-download keeps any prior model.
        File dest = modelFile(modelId);
        File temp = new File(dest.getAbsolutePath() + ".part");
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(30000);
            conn.setReadTimeout(30000);
            activeConnection = conn;
            conn.connect();
            long total = conn.getContentLengthLong();

            long received = 0;
            try (InputStream in = conn.getInputStream();
                 FileOutputStream out = new FileOutputStream(temp)) {
                byte[] buf = new byte[64 * 1024];
                long lastEmit = 0;
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (downloadCanceled) throw new InterruptedException("cancelled");
                    out.write(buf, 0, n);
                    received += n;
                    long now = System.currentTimeMillis();
                    if (now - lastEmit >= 100) {
                        emitProgress(modelId, received, total);
                        lastEmit = now;
                    }
                }
            }

            // A dropped connection ends the read loop cleanly; with a known length,
            // a short read means a truncated (corrupt) file — never rename it over the
            // previous good model.
            if (total > 0 && received != total) {
                temp.delete();
                call.reject("Download failed: truncated (" + received + "/" + total + ")", "DOWNLOAD_FAILED");
                return;
            }

            if (dest.exists()) dest.delete();
            if (!temp.renameTo(dest)) {
                temp.delete();
                call.reject("Failed to save model", "SAVE_FAILED");
                return;
            }
            call.resolve();
        } catch (Exception e) {
            temp.delete(); // clean the partial; never touch dest here
            call.reject("Download failed: " + e.getMessage(), "DOWNLOAD_FAILED");
        } finally {
            if (conn != null) conn.disconnect();
            activeConnection = null;
            downloadInProgress.set(false);
        }
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        downloadCanceled = true;
        HttpURLConnection conn = activeConnection;
        if (conn != null) conn.disconnect(); // unblock a stalled read
        call.resolve();
    }

    private void emitProgress(String modelId, long received, long total) {
        JSObject data = new JSObject();
        data.put("modelId", modelId);
        data.put("bytesDownloaded", received);
        data.put("totalBytes", total);
        notifyListeners("downloadProgress", data);
    }

    // MARK: - Inference

    @PluginMethod
    public void chat(PluginCall call) {
        String modelId = call.getString("modelId");
        String messagesJson = call.getString("messagesJson");
        if (modelId == null) { call.reject("modelId is required"); return; }
        if (messagesJson == null) { call.reject("messagesJson is required"); return; }
        double temperature = call.getDouble("temperature", 0.0);
        int maxTokens = call.getInt("maxTokens", 512);
        int contextSize = call.getInt("contextSize", 2048);

        File file = modelFile(modelId);
        if (!file.exists()) { call.reject("Model is not downloaded", "MODEL_NOT_DOWNLOADED"); return; }

        String[] roles, contents;
        try {
            JSONArray arr = new JSONArray(messagesJson);
            if (arr.length() == 0) throw new Exception("empty messages");
            roles = new String[arr.length()];
            contents = new String[arr.length()];
            for (int i = 0; i < arr.length(); i++) {
                JSONObject m = arr.getJSONObject(i);
                roles[i] = m.optString("role", "user");
                contents[i] = m.optString("content", "");
            }
        } catch (Exception e) {
            call.reject("Failed to apply chat template", "ENGINE_FAILED");
            return;
        }

        // Reject a second concurrent chat immediately (never queue on the executor).
        if (!chatInFlight.compareAndSet(false, true)) {
            call.reject("A chat is already running", "CHAT_BUSY");
            return;
        }

        final String[] fRoles = roles, fContents = contents;
        final String path = file.getAbsolutePath();
        // Where the ggml-cpu variant .so are; the native DL loader needs this (see nativeChat).
        final String libDir = getContext().getApplicationInfo().nativeLibraryDir;
        chatExecutor.execute(() -> {
            // Keep the CPU alive while generating so a screen-off long "think" doesn't freeze.
            // 10-min ceiling so a wedged generation can't pin the CPU indefinitely.
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "zmNinjaNg:NativeLlmChat");
            wl.setReferenceCounted(false);
            wl.acquire(10 * 60 * 1000L);
            try {
                int[] counts = new int[2];
                byte[] bytes = nativeChat(modelId, path, libDir, fRoles, fContents,
                                          temperature, maxTokens, contextSize, counts);
                JSObject ret = new JSObject();
                ret.put("content", new String(bytes, StandardCharsets.UTF_8));
                ret.put("promptTokens", counts[0]);
                ret.put("completionTokens", counts[1]);
                call.resolve(ret);
            } catch (RuntimeException e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Engine failed", "ENGINE_FAILED");
            } finally {
                if (wl.isHeld()) wl.release();
                chatInFlight.set(false);
            }
        });
    }

    @PluginMethod
    public void cancelChat(PluginCall call) {
        nativeCancelChat();
        call.resolve();
    }

    @PluginMethod
    public void unload(PluginCall call) {
        if (chatInFlight.get()) {
            call.reject("A reply is being generated; try again when it finishes", "CHAT_BUSY");
            return;
        }
        nativeUnload();
        call.resolve();
    }

    // MARK: - Paths

    private File modelsDir() {
        // getNoBackupFilesDir is the Android analog of iOS's backup-excluded Application Support.
        File dir = new File(getContext().getNoBackupFilesDir(), "NativeLlm");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private File modelFile(String modelId) {
        // modelId becomes a filename: strip anything that could escape the directory.
        StringBuilder safe = new StringBuilder();
        for (int i = 0; i < modelId.length(); i++) {
            char c = modelId.charAt(i);
            boolean ok = Character.isLetterOrDigit(c) || c == '-' || c == '_' || c == '.';
            safe.append(ok ? c : '_');
        }
        return new File(modelsDir(), safe + ".gguf");
    }
}
