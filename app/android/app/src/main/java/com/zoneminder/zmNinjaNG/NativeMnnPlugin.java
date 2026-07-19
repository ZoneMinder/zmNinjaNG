package com.zoneminder.zmNinjaNG;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import javax.net.ssl.HttpsURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import org.json.JSONException;
import org.json.JSONObject;

/** Native MNN bridge. The accepted models are fixed here, not supplied by JS. */
@CapacitorPlugin(name = "NativeMnn")
public class NativeMnnPlugin extends Plugin {
    /** False when this device has no native library for its ABI. */
    private static final boolean NATIVE_AVAILABLE;

    static {
        // GUARDED. This runs during registerPlugin() in MainActivity.onCreate,
        // so an UnsatisfiedLinkError here becomes ExceptionInInitializerError
        // and takes the WHOLE APP down at launch, not just the assistant. The
        // native libraries are built for arm64-v8a only, so any other ABI (an
        // x86_64 emulator, a 32-bit device) would have crashed on startup.
        boolean available;
        try {
            System.loadLibrary("zmninja_mnn");
            available = true;
        } catch (UnsatisfiedLinkError noNative) {
            available = false;
            android.util.Log.w("NativeMnn", "On-device assistant unavailable for this ABI", noNative);
        }
        NATIVE_AVAILABLE = available;
    }

    /** Rejects the call when there is no native library on this device, so a
     *  plugin method fails as a handled error rather than an UnsatisfiedLinkError
     *  escaping into the bridge. */
    private boolean rejectIfUnavailable(PluginCall call) {
        if (NATIVE_AVAILABLE) return false;
        call.reject("The on-device assistant is not supported on this device.");
        return true;
    }
    /** Returns the backend actually in use, or empty if the load failed. */
    private static native String loadNative(String configPath, boolean useGpu);
    /** Returns {content, promptTokens, completionTokens}, empty if load failed. */
    private static native String[] chatNative(String configPath, String[] roles, String[] contents, int maxTokens, boolean useGpu);
    private static native void unloadNative();

    /** Set by cancelDownload(), read by the download read loop on the bridge
     *  executor: a 1.4GB model is a long, cancellable operation. */
    private volatile boolean downloadCancelled = false;

    private File modelDirectory(String modelId) {
        if (!"Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN".equals(modelId)) return null;
        return new File(getContext().getFilesDir(), "mnn/" + modelId);
    }

    @PluginMethod
    public void isDownloaded(PluginCall call) {
        if (rejectIfUnavailable(call)) return;
        File dir = modelDirectory(call.getString("modelId", ""));
        JSObject result = new JSObject();
        result.put("downloaded", dir != null && new File(dir, ".complete").isFile());
        call.resolve(result);
    }

    @PluginMethod
    public void deleteModel(PluginCall call) {
        if (rejectIfUnavailable(call)) return;
        File dir = modelDirectory(call.getString("modelId", ""));
        if (dir == null) { call.reject("Unsupported native MNN model"); return; }
        unloadNative();
        deleteTree(dir);
        call.resolve();
    }

    @PluginMethod
    public void download(PluginCall call) {
        if (rejectIfUnavailable(call)) return;
        String modelId = call.getString("modelId", "");
        File dir = modelDirectory(modelId);
        ModelSpec spec = ModelSpec.forId(modelId);
        if (dir == null || spec == null) { call.reject("Unsupported native MNN model"); return; }
        downloadCancelled = false;
        getBridge().execute(() -> {
            try {
                deleteTree(dir);
                if (!dir.mkdirs()) throw new IllegalStateException("Cannot create model directory");
                for (int index = 0; index < spec.files.length; index++) {
                    if (downloadCancelled) throw new IllegalStateException("Native MNN download cancelled");
                    downloadFile(spec, spec.files[index], dir, modelId, index + 1);
                }
                if (!new File(dir, ".complete").createNewFile()) throw new IllegalStateException("Cannot finalize model download");
                call.resolve();
            } catch (Exception error) {
                deleteTree(dir);
                call.reject("Native MNN download failed: " + error.getMessage(), error);
            }
        });
    }

    /** Runs on the bridge's executor, not the caller's thread: on-device
     *  generation takes seconds, and this used to block the UI thread. */
    @PluginMethod
    public void chat(PluginCall call) {
        if (rejectIfUnavailable(call)) return;
        File dir = modelDirectory(call.getString("modelId", ""));
        if (dir == null || !new File(dir, ".complete").isFile()) { call.reject("Native MNN model is not downloaded."); return; }
        JSArray messages = call.getArray("messages");
        int count = messages == null ? 0 : messages.length();
        if (count == 0) { call.reject("Native MNN chat requires at least one message."); return; }
        String[] roles = new String[count], contents = new String[count];
        try {
            for (int i = 0; i < count; i++) {
                JSONObject message = messages.getJSONObject(i);
                roles[i] = message.optString("role", "user");
                contents[i] = message.optString("content", "");
            }
        } catch (JSONException error) { call.reject("Native MNN chat received a malformed message list.", error); return; }
        int maxTokens = call.getInt("maxTokens", 1024);
        final boolean useGpu = Boolean.TRUE.equals(call.getBoolean("useGpu", false));
        getBridge().execute(() -> {
            String[] response = chatNative(new File(dir, "config.json").getAbsolutePath(), roles, contents, maxTokens, useGpu);
            if (response.length < 3) { call.reject("Native MNN could not load the model."); return; }
            JSObject result = new JSObject();
            result.put("content", response[0]);
            // MNN's own token counts, so the app measures real context usage
            // instead of estimating it from characters.
            result.put("promptTokens", Integer.parseInt(response[1]));
            result.put("completionTokens", Integer.parseInt(response[2]));
            call.resolve(result);
        });
    }

    /** Loads the model without generating, so the UI can tell the user why the
     *  first turn is slow. Folded into chat(), a 10s load looked like a hang. */
    @PluginMethod
    public void load(PluginCall call) {
        if (rejectIfUnavailable(call)) return;
        File dir = modelDirectory(call.getString("modelId", ""));
        if (dir == null || !new File(dir, ".complete").isFile()) { call.reject("Native MNN model is not downloaded."); return; }
        final boolean useGpu = Boolean.TRUE.equals(call.getBoolean("useGpu", false));
        getBridge().execute(() -> {
            String backend = loadNative(new File(dir, "config.json").getAbsolutePath(), useGpu);
            if (backend.isEmpty()) { call.reject("Native MNN could not load the model."); return; }
            JSObject result = new JSObject();
            result.put("backend", backend);
            call.resolve(result);
        });
    }

    /** The in-flight download's catch block deletes the partial directory. */
    @PluginMethod
    public void cancelDownload(PluginCall call) {
        if (rejectIfUnavailable(call)) return; downloadCancelled = true; call.resolve(); }

    @PluginMethod
    public void getModelSize(PluginCall call) {
        if (rejectIfUnavailable(call)) return;
        File dir = modelDirectory(call.getString("modelId", ""));
        if (dir == null) { call.reject("Unsupported native MNN model"); return; }
        JSObject result = new JSObject();
        result.put("bytes", treeSize(dir));
        call.resolve(result);
    }

    @PluginMethod
    public void unload(PluginCall call) {
        if (rejectIfUnavailable(call)) return;
        unloadNative();
        call.resolve();
    }

    private static long treeSize(File file) {
        File[] children = file.listFiles();
        if (children == null) return file.isFile() ? file.length() : 0;
        long total = 0;
        for (File child : children) total += treeSize(child);
        return total;
    }

    private static void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        file.delete();
    }

    private void downloadFile(ModelSpec spec, ModelFile file, File directory, String modelId, int fileIndex) throws Exception {
        URL url = new URL("https://huggingface.co/" + spec.repository + "/resolve/" + spec.revision + "/" + file.name);
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setConnectTimeout(30000); connection.setReadTimeout(30000);
        File target = new File(directory, file.name), partial = new File(directory, file.name + ".part");
        try (var input = connection.getInputStream(); var output = new FileOutputStream(partial)) {
            long written = 0, total = connection.getContentLengthLong(); int lastProgress = -1;
            byte[] buffer = new byte[8192]; int read;
            while ((read = input.read(buffer)) != -1) {
                if (downloadCancelled) throw new IllegalStateException("Native MNN download cancelled");
                output.write(buffer, 0, read);
                written += read;
                if (total > 0) {
                    int progress = (int) (written * 100 / total);
                    if (progress != lastProgress) {
                        lastProgress = progress;
                        JSObject update = new JSObject();
                        update.put("modelId", modelId); update.put("fileName", file.name); update.put("fileIndex", fileIndex);
                        update.put("fileCount", spec.files.length); update.put("fileProgress", progress);
                        update.put("fileBytesWritten", written); update.put("fileBytesTotal", total);
                        notifyListeners("downloadProgress", update);
                    }
                }
            }
        } finally { connection.disconnect(); }
        if (!sha256(partial).equals(file.sha256)) throw new IllegalStateException("Checksum failed for " + file.name);
        if (!partial.renameTo(target)) throw new IllegalStateException("Cannot finalize " + file.name);
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (var input = new FileInputStream(file)) { byte[] b = new byte[8192]; int n; while ((n = input.read(b)) != -1) digest.update(b, 0, n); }
        StringBuilder hex = new StringBuilder(); for (byte value : digest.digest()) hex.append(String.format("%02x", value)); return hex.toString();
    }

    private record ModelFile(String name, String sha256) {}
    private record ModelSpec(String repository, String revision, ModelFile[] files) {
        static ModelSpec forId(String id) {
            if ("Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN".equals(id)) return new ModelSpec("taobao-mnn/Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN", "3ebd7e8f68fc0d03b107a6a0828889d646f4a5db", new ModelFile[] {
                new ModelFile("config.json", "92853033efe602f95efca3e1c05cd8b108f973c8beed417843a9671f8147ed8d"), new ModelFile("llm.mnn", "aac90290bde6d7746b0df08f06582a6004747c0c3ab5760ce652a6eaad6d2d61"),
                new ModelFile("llm.mnn.json", "7a26766882e7ab40570a1af7eb6090408e21b4cdd59fbe448cef47d3b6a28059"), new ModelFile("llm.mnn.weight", "e01b6e410837fee107466a228717b0e06e8d0b62398c3540bfdd4994977896ba"),
                new ModelFile("llm_config.json", "ba0b3ec3d7eb600f4cfbac62d765f0e4427bef79c15b9fda9e45649a3b16c167"), new ModelFile("tokenizer.txt", "3f1f5a131d209db739382cd25cf5cc0b2769c87503878a12e4f3a1ed4ca2311c"),
                new ModelFile("visual.mnn", "433014df11d78b53092dc32d8e143d22d321386eb71c9b07847720e94d3407f5"), new ModelFile("visual.mnn.weight", "8f90e106f5b9ae9a939faed240305cfdd5c6740ae91d3fc418a990bee0cce36b") });
            return null;
        }
    }
}
