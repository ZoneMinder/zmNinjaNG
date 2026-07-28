package com.zoneminder.zmNinjaNG;

import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.genai.common.DownloadCallback;
import com.google.mlkit.genai.common.FeatureStatus;
import com.google.mlkit.genai.common.GenAiException;
import com.google.mlkit.genai.prompt.Candidate;
import com.google.mlkit.genai.prompt.GenerateContentRequest;
import com.google.mlkit.genai.prompt.GenerateContentResponse;
import com.google.mlkit.genai.prompt.Generation;
import com.google.mlkit.genai.prompt.SystemInstruction;
import com.google.mlkit.genai.prompt.TextPart;
import com.google.mlkit.genai.prompt.java.GenerativeModelFutures;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Gemini Nano plugin: the Android system model, reached through AICore via the
 * ML Kit GenAI Prompt API. Android counterpart of
 * app/ios/App/App/AppleIntelligencePlugin.swift, and deliberately the same JS
 * contract minus the two things ML Kit has no equivalent for: there is no
 * native tool loop (`resolveToolCall`) and no runtime output schema
 * (`schemaJson`), because ML Kit's structured output is a compile-time Kotlin
 * codegen with no union type. The JS side therefore drives this backend with
 * the textual turn contract instead, exactly as it drives llama.cpp.
 * JS contract: app/src/plugins/gemini-nano/definitions.ts.
 *
 * Unlike Apple's system model the weights are NOT already on the device: AICore
 * downloads them on request, so this plugin carries the download surface
 * NativeLlm has, and `isSupported` reports the downloadable state rather than
 * claiming support the first chat would fail on.
 */
@CapacitorPlugin(name = "GeminiNano")
public class GeminiNanoPlugin extends Plugin {

    /** Reserved out of the advertised window for the reply, mirroring
     *  AppleIntelligencePlugin's responseReserve: the JS auto-clear budget has to leave
     *  room for the completion, or a turn that fits the window still truncates mid-JSON
     *  and fails to parse. */
    private static final int RESPONSE_RESERVE = 1024;

    /** Fallback window when `getTokenLimit()` is unavailable. ML Kit documents the Prompt
     *  API input limit as under 4000 tokens; used only if the real number cannot be read. */
    private static final int DEFAULT_TOKEN_LIMIT = 4000;

    /** Two independent busy slots, not one, for the same reason
     *  AppleIntelligencePlugin has them: the JS window interpreter nests a one-shot
     *  completion inside a bridged tool call, so a utility call is legitimately in flight
     *  while the tool-loop chat waits on JS. Only same-kind concurrency is rejected. */
    private final AtomicReference<ListenableFuture<GenerateContentResponse>> chatCall = new AtomicReference<>();
    private final AtomicReference<ListenableFuture<GenerateContentResponse>> utilityCall = new AtomicReference<>();

    private GenerativeModelFutures model;

    /** One client for the process. `Generation.getClient()` is left unconfigured: its
     *  ModelConfig knobs (FAST vs FULL, release stage) are unmeasured on this app's
     *  prompts, and picking one before the eval has run would be a guess dressed as a
     *  setting — ponytail: revisit once prompt-eval has Nano numbers. */
    private synchronized GenerativeModelFutures model() {
        if (model == null) model = GenerativeModelFutures.from(Generation.INSTANCE.getClient());
        return model;
    }

    /** ML Kit GenAI is compiled against API 26 and this app ships to 24 (see the
     *  `tools:overrideLibrary` note in AndroidManifest.xml). Every entry point checks this
     *  first, so no ML Kit class is ever loaded on a device whose runtime cannot verify it.
     *  Costs nothing in practice: AICore does not exist below Android 14. */
    private static boolean hasMlKit() {
        return android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O;
    }

    /** Whether this device's Gemini Nano build accepts a SystemInstruction. Probed once and
     *  remembered: it is a property of the installed model, and the model does not change
     *  under a running process. Unreadable means no, so the system text is folded into the
     *  prompt rather than risking a silently ignored instruction. */
    private synchronized boolean systemPromptSupported() {
        if (systemPromptSupported == null) {
            try {
                systemPromptSupported = model().isSystemPromptAvailable().get();
            } catch (Exception e) {
                logWarn("system-prompt support unknown, folding it into the prompt", e);
                systemPromptSupported = false;
            }
        }
        return systemPromptSupported;
    }

    private Boolean systemPromptSupported;

    // MARK: - Capability

    /**
     * Maps ML Kit's four-state `checkStatus` onto the same shape
     * AppleIntelligencePlugin.isSupported resolves, so the JS provider treats both system
     * models identically. DOWNLOADABLE and DOWNLOADING are NOT "supported": the model
     * cannot answer yet, and reporting otherwise would surface an engine error instead of
     * the download affordance.
     */
    @PluginMethod
    public void isSupported(PluginCall call) {
        if (!hasMlKit()) {
            JSObject result = new JSObject();
            result.put("supported", false);
            result.put("reason", "platform");
            call.resolve(result);
            return;
        }
        futureCallback(model().checkStatus(), call, status -> {
            JSObject result = new JSObject();
            if (status == FeatureStatus.AVAILABLE) {
                // Advertise the USABLE window, not the raw limit (see RESPONSE_RESERVE).
                // A failed limit read is not a failed probe: the model IS available, so fall
                // back to the documented cap rather than reporting it unsupported.
                int limit = DEFAULT_TOKEN_LIMIT;
                try {
                    limit = model().getTokenLimit().get();
                } catch (Exception e) {
                    logWarn("token limit unavailable, using the documented cap", e);
                }
                result.put("supported", true);
                result.put("contextSize", Math.max(RESPONSE_RESERVE, limit) - RESPONSE_RESERVE);
                // Load the weights now so the first real turn does not pay it, matching the
                // prewarm AppleIntelligencePlugin does on this same probe. Fire and forget:
                // a failed warmup costs latency, never correctness.
                model().warmup();
            } else {
                result.put("supported", false);
                result.put("reason", status == FeatureStatus.DOWNLOADABLE || status == FeatureStatus.DOWNLOADING
                        ? "notReady"
                        : "platform");
            }
            call.resolve(result);
        });
    }

    /**
     * Downloads the Gemini Nano weights through AICore, emitting `downloadProgress` with the
     * same `{bytesDownloaded, totalBytes}` shape NativeLlm's download uses so the JS progress
     * UI is shared. `onDownloadProgress` reports bytes downloaded so far and
     * `onDownloadStarted` the total, which is the reverse of the order the event needs them
     * in, hence the remembered total.
     */
    @PluginMethod
    public void download(PluginCall call) {
        if (!hasMlKit()) {
            call.reject("Gemini Nano is not available on this Android version", "MODEL_NOT_AVAILABLE");
            return;
        }
        final long[] total = { 0 };
        model().download(new DownloadCallback() {
            @Override
            public void onDownloadStarted(long bytesToDownload) {
                total[0] = bytesToDownload;
            }

            @Override
            public void onDownloadProgress(long totalBytesDownloaded) {
                JSObject event = new JSObject();
                event.put("bytesDownloaded", totalBytesDownloaded);
                event.put("totalBytes", total[0]);
                notifyListeners("downloadProgress", event);
            }

            @Override
            public void onDownloadCompleted() {
                call.resolve();
            }

            @Override
            public void onDownloadFailed(GenAiException e) {
                call.reject(message(e), errorCode(e));
            }
        });
    }

    // MARK: - Inference

    /**
     * One turn. `messagesJson` is the OpenAI-shaped array every backend in this app is
     * driven with; ML Kit has no multi-turn session, so the conversation is flattened into
     * a single prompt (see `renderPrompt`) with the system text carried separately.
     */
    @PluginMethod
    public void chat(PluginCall call) {
        if (!hasMlKit()) {
            call.reject("Gemini Nano is not available on this Android version", "MODEL_NOT_AVAILABLE");
            return;
        }
        String messagesJson = call.getString("messagesJson");
        if (messagesJson == null) {
            call.reject("messagesJson is required");
            return;
        }
        boolean utility = Boolean.TRUE.equals(call.getBoolean("utility", false));
        AtomicReference<ListenableFuture<GenerateContentResponse>> slot = utility ? utilityCall : chatCall;
        if (slot.get() != null) {
            call.reject("A chat is already running", "CHAT_BUSY");
            return;
        }

        String systemText;
        String prompt;
        try {
            JSONArray messages = new JSONArray(messagesJson);
            systemText = joinRole(messages, "system");
            prompt = renderPrompt(messages);
        } catch (Exception e) {
            call.reject("messagesJson is invalid");
            return;
        }
        if (prompt.isEmpty()) {
            call.reject("messagesJson has no user message");
            return;
        }

        // A system prompt is a per-model capability, not a per-API one: nano-v3 on a Pixel 10
        // reports isSystemPromptAvailable() == false, and passing a SystemInstruction it cannot
        // honour would silently drop the entire tool catalog and the install-specific facts.
        // Folded into the prompt instead, which is what the WebLLM/llama.cpp path does anyway.
        GenerateContentRequest.Builder builder;
        if (systemText.isEmpty()) {
            builder = new GenerateContentRequest.Builder(new TextPart(prompt));
        } else if (systemPromptSupported()) {
            builder = new GenerateContentRequest.Builder(new SystemInstruction(systemText), new TextPart(prompt));
        } else {
            builder = new GenerateContentRequest.Builder(new TextPart(systemText + "\n\n" + prompt));
        }
        builder.setTemperature(call.getDouble("temperature", 0.0).floatValue());
        builder.setMaxOutputTokens(call.getInt("maxTokens", 512));
        // Thinking off, as on every other backend: measured across Ollama and WebLLM it costs
        // several times the latency for the same eval score, and this window cannot afford
        // tokens spent on reasoning the parser discards (see agents/project/llm-models.md).
        builder.setEnableThinking(false);
        GenerateContentRequest request = builder.build();

        ListenableFuture<GenerateContentResponse> future = model().generateContent(request);
        slot.set(future);
        futureCallback(future, call, response -> {
            slot.set(null);
            List<Candidate> candidates = response.getCandidates();
            String content = candidates.isEmpty() ? "" : candidates.get(0).getText();
            JSObject result = new JSObject();
            result.put("content", content == null ? "" : content);
            // Prompt tokens exact, completion tokens left to the JS estimate. The prompt count
            // is what the auto-clear budget spends against a ~3000-token window, so a guess
            // there overflows the context; the completion count only labels the transcript,
            // and counting it would cost a second IPC round trip per turn to earn that.
            try {
                result.put("promptTokens", model().countTokens(request).get().getTotalTokens());
            } catch (Exception e) {
                logWarn("token count unavailable for this turn", e);
            }
            call.resolve(result);
        }, () -> slot.set(null));
    }

    /**
     * Abandons the in-flight generations without cancelling them natively.
     *
     * Cancelling the future is what you would expect here, and it crashes the app.
     * genai-prompt 1.0.0-beta4 is compiled against kotlinx-coroutines 1.7.3, where
     * `Job.cancel$default` lives in `Job$DefaultImpls`; this app resolves coroutines
     * 1.10.2 (forced by a BOM elsewhere in the graph), which dropped that class. So
     * ML Kit's cancellation path throws `NoSuchMethodError` on its own thread pool,
     * uncaught, and takes the process down. Observed on a Pixel 10 the moment a
     * screen holding a running generation unmounted.
     *
     * Clearing the slot is enough for everything the JS side needs: it turns an
     * aborted call into an AbortError on its own, and the abandoned generation's
     * result is simply discarded. The cost is that the model keeps computing for
     * the second or so it had left, which is not worth crashing to avoid.
     * ponytail: call `future.cancel(true)` again once ML Kit ships a build compiled
     * against coroutines 1.10+, which makes a cancelled turn stop burning the NPU.
     */
    @PluginMethod
    public void cancelChat(PluginCall call) {
        chatCall.set(null);
        utilityCall.set(null);
        call.resolve();
    }

    // MARK: - Prompt assembly

    /** Every message of one role, joined. System prompts are built as one block upstream
     *  but the contract allows several, and dropping the extras would silently drop facts
     *  the tools depend on. */
    private static String joinRole(JSONArray messages, String role) throws Exception {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < messages.length(); i++) {
            JSONObject message = messages.getJSONObject(i);
            if (!role.equals(message.optString("role"))) continue;
            if (out.length() > 0) out.append("\n\n");
            out.append(message.optString("content"));
        }
        return out.toString();
    }

    /**
     * The conversation as one prompt string: prior turns labelled, then the last user
     * message on its own as the thing to answer.
     *
     * ML Kit's Prompt API takes a single request with no session and no role-typed
     * history, so multi-turn has to be rendered into the prompt text. The labels are
     * protocol, not user-facing copy: the assistant turns being replayed are the JSON
     * envelopes of the turn contract, and the model has to see which side said what to
     * continue the pattern. Returns "" when there is no user message to answer.
     */
    private static String renderPrompt(JSONArray messages) throws Exception {
        int lastUser = -1;
        for (int i = messages.length() - 1; i >= 0; i--) {
            if ("user".equals(messages.getJSONObject(i).optString("role"))) {
                lastUser = i;
                break;
            }
        }
        if (lastUser < 0) return "";
        StringBuilder history = new StringBuilder();
        for (int i = 0; i < lastUser; i++) {
            JSONObject message = messages.getJSONObject(i);
            String role = message.optString("role");
            if ("system".equals(role)) continue; // carried as the SystemInstruction
            history.append("assistant".equals(role) ? "Assistant: " : "User: ")
                    .append(message.optString("content"))
                    .append("\n\n");
        }
        return history + messages.getJSONObject(lastUser).optString("content");
    }

    // MARK: - Futures and errors

    private interface Resolver<T> {
        void resolve(T value) throws Exception;
    }

    /**
     * Bridges one ListenableFuture to a Capacitor call. ML Kit runs its own executor and
     * hands the result back on it, so the blocking `get()` happens on this plugin's own
     * background thread rather than the caller's; Capacitor calls are safe to resolve from
     * any thread.
     */
    private <T> void futureCallback(ListenableFuture<T> future, PluginCall call, Resolver<T> onValue) {
        futureCallback(future, call, onValue, null);
    }

    private <T> void futureCallback(ListenableFuture<T> future, PluginCall call, Resolver<T> onValue, Runnable onFailure) {
        new Thread(() -> {
            try {
                onValue.resolve(future.get());
            } catch (Throwable t) {
                if (onFailure != null) onFailure.run();
                Throwable cause = t instanceof ExecutionException && t.getCause() != null ? t.getCause() : t;
                call.reject(message(cause), errorCode(cause));
            }
        }).start();
    }

    /** ML Kit's numeric error codes as the stable string codes the JS side already keys on
     *  (the same names LlamaPlugin and AppleIntelligencePlugin reject with), so one mapping
     *  in the provider covers every native backend. Unmapped codes fall through to
     *  ENGINE_FAILED rather than being surfaced as a number no caller understands. */
    private static String errorCode(Throwable t) {
        if (!(t instanceof GenAiException)) return "ENGINE_FAILED";
        switch (((GenAiException) t).getErrorCode()) {
            case GenAiException.ErrorCode.CANCELLED:
                return "CANCELLED";
            case GenAiException.ErrorCode.BUSY:
                return "CHAT_BUSY";
            case GenAiException.ErrorCode.REQUEST_TOO_LARGE:
                return "CONTEXT_FULL";
            case GenAiException.ErrorCode.NOT_AVAILABLE:
            case GenAiException.ErrorCode.NOT_SUPPORTED:
            case GenAiException.ErrorCode.AICORE_INCOMPATIBLE:
            case GenAiException.ErrorCode.NEEDS_SYSTEM_UPDATE:
            case GenAiException.ErrorCode.NOT_ENOUGH_DISK_SPACE:
                return "MODEL_NOT_AVAILABLE";
            // AICore refuses to infer for an app that is not in the foreground, and meters
            // each app's daily use. Both are recoverable by the user, so they get their own
            // codes instead of a generic engine failure they cannot act on.
            case GenAiException.ErrorCode.BACKGROUND_USE_BLOCKED:
                return "BACKGROUND_BLOCKED";
            case GenAiException.ErrorCode.PER_APP_BATTERY_USE_QUOTA_EXCEEDED:
                return "QUOTA_EXCEEDED";
            default:
                return "ENGINE_FAILED";
        }
    }

    private static String message(Throwable t) {
        String message = t.getMessage();
        return message == null || message.isEmpty() ? t.getClass().getSimpleName() : message;
    }

    /** Capacitor's logger, the Java counterpart of the `CAPLog.print` calls
     *  AppleIntelligencePlugin makes for the same non-fatal degradations. */
    private static void logWarn(String what, Throwable t) {
        // Logger has no (tag, message, throwable) warn overload, so the cause is folded
        // into the message rather than dropped.
        Logger.warn("GeminiNano", what + ": " + message(t));
    }
}
