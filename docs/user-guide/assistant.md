# Assistant

Ninjii answers questions about your cameras and events, and can take you to a screen in the app. It is read-only: it cannot change or delete anything on your ZoneMinder server. The model that answers runs either on your device or on a server you run yourself. Nothing goes to a server operated by zmNinjaNg or any AI company.

## Enabling the Assistant

Go to **Settings > Ninjii** and turn on **Enable Ninjii**.

Underneath, **Backend** picks where the model runs:

- **On-device**: the model runs inside the app on your computer's GPU, using WebGPU. Nothing leaves your device. **Desktop and web only** (see below).
- **Ollama**: the model runs on an [Ollama](https://ollama.com) server (or anything else speaking the OpenAI-compatible chat API) that you point the app at.

On-device is not offered on phones or tablets: the models need more memory than a mobile app is allowed to use, so they crash it. On a phone or tablet the on-device option is greyed out with a note, and Ollama is the way to use the assistant there. On a desktop or in a browser, on-device is available whenever your GPU supports WebGPU.

The chat window's header always names the model that is answering and where it runs, for example "Gemma 2 2B · On-device" or "qwen2.5:3b · Ollama", so you never have to open Settings to check which one you are talking to. On the Ollama backend a coloured dot next to that label shows whether the server is reachable: green means connected, red means it cannot be reached (check the address, or that the server is running), and a pulsing amber dot means the app is still checking. The dot rechecks periodically while the window is open. On-device has no server to reach, so no dot appears.

## Asking a Question

Once enabled, there are three ways to start a conversation:

- Press `?` on a keyboard (desktop, web).
- Open the command palette (`/`, the sidebar button, or the mobile header icon) and tap **Ask**.
- Type a leading `?` directly into the command palette's search field.

Before you have typed anything, Ninjii shows a few example prompts as tappable chips (one of them "Summarize my day"). Tapping a chip drops its text into the input so you can send it as-is or edit it first.

Type your question and press Enter (or tap Send). While the assistant is working, a spinner and the name of whatever it is doing (for example, looking up an event or checking a monitor) show above the input. Tap the stop button to cancel a request in progress.

### On a phone

The assistant is a bottom sheet that shares the screen instead of covering it, so the app stays visible above it. Its tinted header, accent outline, and shadow separate the Ninjii workspace from the app. It rests as a slim bar at the bottom. Drag the grip at the top of the sheet up to any height to see more of the conversation, or down to shrink it. Tapping the input grows the sheet above the keyboard so you can read replies as you type. The chevron collapses the sheet to a floating button (tap the button to bring it back), and the X closes it. The sheet keeps its proportion when you rotate the phone.

On a tablet or desktop the assistant is a floating, resizable card in the bottom-right corner instead, with the same tinted header, accent outline, and shadow.

Examples of what you can ask:

- "Is the server ok?"
- "How many events happened on the driveway camera in the last hour?"
- "Show me the most recent event on the front door camera" (the assistant navigates you there)
- "Arm the backyard camera" / "Disable the garage camera"
- "Delete event 1234"

The assistant only knows what its tools can look up: your monitors, events, groups, tags, and server health. It cannot answer questions unrelated to this ZoneMinder server.

## The assistant cannot change anything

The assistant is read-only. It can look things up and take you to a screen, and that is all. It cannot arm or disarm a monitor, trigger or cancel an alarm, change a monitor's function, change the run state, or delete or archive an event.

This is deliberate. The assistant works by having a language model choose which action matches your words, and a model can misread a request: "clear out today's events" is one phrasing away from deleting them, and "I'm home" is one phrasing away from changing your run state. Earlier versions asked you to confirm each action first, but that put the entire safeguard on a single tap, in a dialog that looks the same whether the model understood you or not. Deleting an event cannot be undone, and a monitor left disarmed records nothing.

Ask for one of these and the assistant will say it cannot do it and point you to the screen where you can: monitors and arming on **Monitors**, run state on **Server**, deleting and archiving on the event itself. Doing it there means you picked the target yourself.

## The on-device model (desktop and web)

On a desktop or in a browser, the model runs inside the app using your GPU (WebGPU), the same way a game or video effect uses the GPU, rather than sending your conversation to a company's servers over the internet. This is not available on phones or tablets; use Ollama there.

**Settings > Ninjii > Model** picks which one, then **Download** fetches it. The download runs as a background task you can watch or cancel, and the model is stored on your device until you tap **Delete**. The models are listed smallest first:

| Model | Download | Notes |
|---|---|---|
| Llama 3.2 1B | ~879 MB | The lightest. Handles tool calls. |
| Qwen2.5 0.5B | ~945 MB | The smallest with tool calling. Lowest quality, but frugal. |
| Qwen3 0.6B | ~1400 MB | Adds step-by-step reasoning to tool calling. The best small answers. |
| Gemma 2 2B | ~1895 MB | The default. Needs a GPU feature (`shader-f16`) some GPUs lack. |
| Qwen3 1.7B | ~2037 MB | Stronger, if your machine has the memory. |
| Llama 3.2 3B | ~2264 MB | The most capable, and the heaviest. |

The download sizes are a floor, not the total: running a model needs additional memory on top of its weights, and how much depends on how long the conversation gets.

Loading a different on-device model unloads the current one first. This keeps two model engines from occupying GPU memory at once.

:::{warning}
Local models run in your computer's memory. If the app crashes or the model never finishes loading, the machine does not have enough memory for that model. Pick a smaller one, or switch to the Ollama backend to run it on a server instead. This is the same note shown next to the model picker in Settings.
:::

## The on-device model (iPhone and Android)

On iPhone and Android, **Settings > Ninjii > Model** uses the native MNN runtime instead of WebGPU. The only available model is **Qwen3.5 2B Reasoning**. Its eight-file download is about 1383 MB and needs additional runtime memory. Download it over Wi-Fi with ample free storage, then test a short question before relying on it.

:::{warning}
Qwen3.5 2B Reasoning is a local model. If download, loading, or a question fails, switch to Ollama. Tool calls remain validated by the app, but a local model can still choose an unsupported tool input.
:::

## Running the model on your own server (Ollama)

Set **Backend** to **Ollama** and give the app the address of your server. The default, `http://localhost:11434/v1`, works when the server runs on the same machine as the app. On a phone, `localhost` means the phone itself, so you need the server's address on your network instead, for example `http://192.168.1.50:11434/v1`.

**Test** checks the server answers. The model list fills in automatically from the server, and you can also type a model name by hand. A GPU-backed Ollama server is recommended. Gemma 4 is the recommended model and may work better than an on-device model. The **API key** field is optional, for a server that requires one; it is stored in your device's secure storage, not alongside the rest of your settings.

## Long conversations

Every model can only hold so much of a conversation at once. Ninjii limits the amount of recent history and each tool result it sends to a model. When an on-device conversation approaches its known limit, Ninjii posts a note saying it has started a fresh one, and stops sending earlier messages to the model. The messages above that note stay on screen for you to read; the model simply no longer sees them. On Ollama the limit belongs to your server's configuration and the app cannot read it, so it cannot know when to clear automatically.

**Clear** in the chat header wipes the conversation entirely at any time. On a phone or tablet it also unloads the on-device model, freeing the memory it was holding, and leaves a note saying so. The model loads again on your next question, which is why that question takes longer than the ones after it.

The app unloads the model when you leave it as well, so a backgrounded app is not sitting on a gigabyte of memory your phone would rather use elsewhere.

While the model is loading, the chat says so instead of showing the usual "Thinking" line, so a long first wait is explained rather than looking like a hang.

## Language

The on-device model works best in English. It is small, and most of its work here is reasoning about your question and then producing a strictly formatted reply, which is where a small model struggles most in other languages. The app's own screens are translated as usual, and answers may come back in your language, but expect more mistakes than in English. A server-backed model through Ollama does not have this limitation.

## Privacy

No third-party AI service ever sees your cameras, events, or questions. Which machines do see them depends on the backend:

- **On-device**: your questions, the answers, and anything the assistant looks up stay on your device. The only network requests are to your own ZoneMinder server, the same requests every other screen in the app makes.
- **Ollama**: the same data, plus your questions and the assistant's answers, also go to the Ollama server you configured. That server is yours; the app never sends the conversation anywhere else.

Either way the conversation is not saved. Closing zmNinjaNg clears it.

## Platform support

The on-device backend runs on desktop and in the browser, where there is enough memory to hold a model, and it needs a GPU with WebGPU support. It is not offered on phones or tablets: a mobile app is capped at far less memory than a model needs, so loading one crashes the app. Ollama has neither requirement and works anywhere the app runs, so it is the way to use the assistant on a phone or tablet, or on a desktop without WebGPU.
