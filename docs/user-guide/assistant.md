# Assistant

Ninjii answers questions about your cameras and events, and can make changes to your ZoneMinder server on request, monitors, alarms, run state, events, after you confirm each one. The model that answers runs either on your device or on a server you run yourself. Nothing goes to a server operated by zmNinjaNg or any AI company.

## Enabling the Assistant

Go to **Settings > Ninjii** and turn on **Enable Ninjii**.

Underneath, **Backend** picks where the model runs:

- **On-device**: the model runs inside the app on your computer's GPU, using WebGPU. Nothing leaves your device. **Desktop and web only** (see below).
- **Ollama**: the model runs on an [Ollama](https://ollama.com) server (or anything else speaking the OpenAI-compatible chat API) that you point the app at.

On-device is not offered on phones or tablets: the models need more memory than a mobile app is allowed to use, so they crash it. On a phone or tablet the on-device option is greyed out with a note, and Ollama is the way to use the assistant there. On a desktop or in a browser, on-device is available whenever your GPU supports WebGPU.

The chat window's header always names the model that is answering and where it runs, for example "Gemma 2 2B · On-device" or "qwen2.5:3b · Ollama", so you never have to open Settings to check which one you are talking to.

## Asking a Question

Once enabled, there are three ways to start a conversation:

- Press `?` on a keyboard (desktop, web).
- Open the command palette (`/`, the sidebar button, or the mobile header icon) and tap **Ask**.
- Type a leading `?` directly into the command palette's search field.

Type your question and press Enter (or tap Send). While the assistant is working, a spinner and the name of whatever it is doing (for example, looking up an event or checking a monitor) show above the input. Tap the stop button to cancel a request in progress.

### On a phone

The assistant is a bottom sheet that shares the screen instead of covering it, so the app stays visible above it. It rests as a slim bar at the bottom. Drag the grip at the top of the sheet up to any height to see more of the conversation, or down to shrink it. Tapping the input grows the sheet above the keyboard so you can read replies as you type. The chevron collapses the sheet to a floating button (tap the button to bring it back), and the X closes it. The sheet keeps its proportion when you rotate the phone.

On a tablet or desktop the assistant is a floating, resizable card in the bottom-right corner instead.

Examples of what you can ask:

- "Is the server ok?"
- "How many events happened on the driveway camera in the last hour?"
- "Show me the most recent event on the front door camera" (the assistant navigates you there)
- "Arm the backyard camera" / "Disable the garage camera"
- "Delete event 1234"

The assistant only knows what its tools can look up: your monitors, events, groups, tags, and server health. It cannot answer questions unrelated to this ZoneMinder server.

## Confirming an action

Any request that changes something on the server, arming or disarming a monitor, triggering or cancelling an alarm, changing a monitor's function, changing the run state, or deleting or archiving an event, always stops and shows a confirmation card describing exactly what it is about to do, with the raw details available under **Details**. Nothing runs until you tap **Confirm**. Tapping **Cancel**, closing the Assistant panel, or navigating away all decline the action instead.

There is no action the assistant can take on the server without this confirmation step. Questions that only look something up (listing monitors, checking event counts, reading server health) never show a confirmation, they cannot change anything.

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

:::{warning}
Local models run in your computer's memory. If the app crashes or the model never finishes loading, the machine does not have enough memory for that model. Pick a smaller one, or switch to the Ollama backend to run it on a server instead. This is the same note shown next to the model picker in Settings.
:::

## Running the model on your own server (Ollama)

Set **Backend** to **Ollama** and give the app the address of your server. The default, `http://localhost:11434/v1`, works when the server runs on the same machine as the app. On a phone, `localhost` means the phone itself, so you need the server's address on your network instead, for example `http://192.168.1.50:11434/v1`.

**Test** checks the server answers. The model list fills in automatically from the server, and you can also type a model name by hand. The **API key** field is optional, for a server that requires one; it is stored in your device's secure storage, not alongside the rest of your settings.

## Long conversations

Every model can only hold so much of a conversation at once. When a conversation approaches that limit, Ninjii posts a note saying it has started a fresh one, and stops sending the earlier messages to the model. The messages above that note stay on screen for you to read; the model simply no longer sees them. This happens on the on-device backend, where the app knows the model's limit. On Ollama the limit belongs to your server's configuration and the app cannot read it, so nothing is cleared automatically.

**Clear** in the chat header wipes the conversation entirely at any time.

## Privacy

No third-party AI service ever sees your cameras, events, or questions. Which machines do see them depends on the backend:

- **On-device**: your questions, the answers, and anything the assistant looks up stay on your device. The only network requests are to your own ZoneMinder server, the same requests every other screen in the app makes.
- **Ollama**: the same data, plus your questions and the assistant's answers, also go to the Ollama server you configured. That server is yours; the app never sends the conversation anywhere else.

Either way the conversation is not saved. Closing zmNinjaNg clears it.

## Platform support

The on-device backend runs on desktop and in the browser, where there is enough memory to hold a model, and it needs a GPU with WebGPU support. It is not offered on phones or tablets: a mobile app is capped at far less memory than a model needs, so loading one crashes the app. Ollama has neither requirement and works anywhere the app runs, so it is the way to use the assistant on a phone or tablet, or on a desktop without WebGPU.
