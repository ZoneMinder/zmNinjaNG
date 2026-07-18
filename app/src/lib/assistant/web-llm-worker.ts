/// <reference lib="webworker" />
/**
 * WebLLM inference worker (refs #246).
 *
 * Runs model prefill and decode off the main thread. WebLLM's default
 * `CreateMLCEngine` generates on the UI thread, which on a mobile GPU froze the
 * whole app for tens of seconds per turn (Pixel 8 logcat showed sustained
 * `Choreographer` frame drops and 700-1190ms `Davey` jank), so the assistant
 * read as "stuck thinking". In a worker the generation runs off-thread and the
 * UI stays responsive. Not mobile-specific: main-thread inference janks the
 * desktop too, just less visibly.
 *
 * `model-download.ts` spawns this via `CreateWebWorkerMLCEngine`; the handler
 * owns the engine and answers the main thread's chat/reload/unload messages.
 */
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};
