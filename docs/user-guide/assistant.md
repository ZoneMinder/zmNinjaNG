# Ninjii, the assistant

Ninjii answers questions about your cameras and events, and can take you to a screen in the app. It is read-only: it cannot change or delete anything on your ZoneMinder server. The model that answers runs either on your device or on a server you run yourself. Nothing goes to a server operated by zmNinjaNg or any AI company.

## Enabling the Assistant

Go to **Settings > Ninjii** and turn on **Enable Ninjii**.

Underneath, **Backend** picks where the model runs:

- **On-device**: the model runs inside the app on your computer's GPU, using WebGPU. Nothing leaves your device. **Desktop and web only** (see below).
- **Ollama**: the model runs on an [Ollama](https://ollama.com) server (or anything else speaking the OpenAI-compatible chat API) that you point the app at.

On-device is not offered on phones or tablets: the models need more memory than a mobile app is allowed to use, and answers take minutes on phone hardware. There is no backend choice there, just a note saying so and the Ollama settings. On a desktop or in a browser, on-device is available whenever your GPU supports WebGPU.

The chat window's header always names the model that is answering and where it runs, for example "Llama 3.2 3B · On-device" or "llama3.2:latest · Ollama", so you never have to open Settings to check which one you are talking to. On the Ollama backend a coloured dot next to that label shows whether the server is reachable: green means connected, red means it cannot be reached (check the address, or that the server is running), and a pulsing amber dot means the app is still checking. The dot rechecks periodically while the window is open. On-device has no server to reach, so no dot appears.

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
- "Summarize today"
- "How many events happened on the driveway camera in the last hour?"
- "How many people came by yesterday?"
- "What was my busiest hour on Sunday?" (weekday names and "2 days ago" work too)
- "Show me the most recent event on the front door camera" (Ninjii navigates you there)

Answers come with cards underneath: event thumbnails you can tap to open the event, and monitor cards with a live preview when the answer is about a few specific cameras (a long list of monitors stays text, since every preview is a real stream). The cards are the rows the answer is about, not everything the lookup touched: ask for your busiest hour and you get that hour's events, not the whole day's.

Ask it to change something, such as "arm the backyard camera" or "delete event 1234", and it will tell you it cannot and point you to the screen where you can. See below for why.

Ninjii only knows what its tools can look up: your monitors, events, groups, tags, and server health. Ask it something unrelated to this ZoneMinder server and it answers as an ordinary assistant would, without pretending to have looked anything up.

## The assistant cannot change anything

The assistant is read-only. It can look things up and take you to a screen, and that is all. It cannot arm or disarm a monitor, trigger or cancel an alarm, change a monitor's function, change the run state, or delete or archive an event.

This is deliberate. The assistant works by having a language model choose which action matches your words, and a model can misread a request: "clear out today's events" is one phrasing away from deleting them, and "I'm home" is one phrasing away from changing your run state. Earlier versions asked you to confirm each action first, but that put the entire safeguard on a single tap, in a dialog that looks the same whether the model understood you or not. Deleting an event cannot be undone, and a monitor left disarmed records nothing.

Ask for one of these and the assistant will say it cannot do it and point you to the screen where you can: monitors and arming on **Monitors**, run state on **Server**, deleting and archiving on the event itself. Doing it there means you picked the target yourself.

## The on-device model (desktop and web)

On a desktop or in a browser, the model runs inside the app using your GPU (WebGPU), the same way a game or video effect uses the GPU, rather than sending your conversation to a company's servers over the internet. This is not available on phones or tablets; use Ollama there.

**Settings > Ninjii > Model** shows which model runs, then **Download** fetches it. The download runs as a background task you can watch or cancel, and the model is stored on your device until you tap **Delete**.

| Model | Download | Notes |
|---|---|---|
| Llama 3.2 3B | ~2264 MB | The default. Fastest download, smallest memory footprint. |
| Qwen3 4B | ~3432 MB | Answers camera questions more accurately in server-side testing. Needs about a gigabyte more GPU memory. |

Earlier versions offered a choice of six models. The models that choice replaced varied widely in whether they would use a tool at all, so the list is now short and every entry on it is tested against the same question suite. If your settings still name a model that was removed, the app moves you to Llama 3.2 3B automatically.

The download size is a floor, not the total: running a model needs additional memory on top of its weights, and how much depends on how long the conversation gets.

:::{warning}
Local models run in your computer's memory. If the app crashes or the model never finishes loading, the machine does not have enough memory for it. Switch to the Ollama backend to run the model on a server instead. This is the same note shown next to the model picker in Settings.
:::

## Running the model on your own server (Ollama)

Set **Backend** to **Ollama** and give the app the address of your server. Left empty, the app uses your ZoneMinder server's own address on port 11434, which is right when Ollama runs on that machine. The field's placeholder shows the address it will use. Type a different one if your Ollama server is elsewhere. Avoid `localhost` on a phone: there it means the phone itself, which is not running Ollama.

**Test model**, next to the model list, checks two separate things and tells you which one failed. First that the server answers at all, and then that the model you picked can call the app's tools. A model that cannot, such as gemma2, is reachable but useless here: it never looks anything up, so the assistant can only guess. A large model may take a minute to answer the first test while the server loads it into memory, and the button reports which step it is waiting on.

The model list fills in automatically from the server, and you can also type a model name by hand. A GPU-backed Ollama server is recommended, and Qwen3 8B on one answers noticeably better than the on-device model; Llama 3.2 is a good pick when you want the fastest possible replies. If your server does not have the recommended model, Settings shows you the `ollama pull` command to add it. The **API key** field is optional, for a server that requires one; it is stored in your device's secure storage, not alongside the rest of your settings.

## Performance and accuracy

Which model you pick matters more than any other assistant setting. zmNinjaNg carries a test suite for exactly this: fourteen camera-and-events questions ("summarize today", "how many people came today", "compare may to june", "is the server ok", and so on), each asked three times against known data, scored on whether the model looked the right thing up with usable filters and whether its answer quoted the data correctly. Every claim below comes from that suite, measured in July 2026 against Ollama 0.32 on a GPU server. Your hardware changes the times, not the accuracy.

| Ollama model | Accuracy | Typical reply |
|---|---|---|
| **qwen3:8b** (recommended) | every check passed | about 2 seconds |
| llama3.2 | every check passed, leaning on the app's guardrails | about half a second |
| qwen3:30b-a3b | every check passed | about 11 seconds |
| qwen3:4b | every check passed | about 20 seconds |
| qwen3:1.7b | roughly a third of checks failed | about 3 seconds |

Why qwen3:8b: it is the smallest model that passed every check on its own judgement. It never mistook small talk for a camera question, and never dropped the object filter on questions like "how many people came today". llama3.2 reaches the same final scores but only because the app corrects it along the way, and each correction costs an extra round trip; it stays the right choice when reply speed matters most.

Two things to know about the qwen3 family:

- They are "thinking" models that normally reason at length before answering. The app turns that off automatically on Ollama, which made replies about five times faster in testing with identical accuracy. The very first question after the app meets a new server still includes one slow, thinking reply.
- The size tag matters: qwen3:8b passed everything, while qwen3:1.7b failed a third of the same checks. A sibling tag is a different model, not a smaller copy of the same one.

Some models cannot drive the assistant at all: gemma2 has no tool support and qwen2.5-coder never uses one, so with either the assistant can only guess. The **Test model** button catches both cases before you commit to a model.

The on-device Llama 3.2 3B passed 21 of 24 lookup checks in an equivalent test. Its misses were answering from memory instead of looking things up, which the app detects and corrects by insisting on a lookup, at the cost of a slower reply. The on-device Qwen3 4B option scored between Llama 3.2 and the server-backed qwen3:8b in the same suite, at the cost of a larger download and more GPU memory. A server-backed qwen3:8b answers noticeably better and faster than either; on-device remains the choice when the conversation must not leave your machine.

## Long conversations

Every model can only hold so much of a conversation at once. Ninjii limits the amount of recent history and each tool result it sends to a model. When an on-device conversation approaches its known limit, Ninjii posts a note saying it has started a fresh one, and stops sending earlier messages to the model. The messages above that note stay on screen for you to read; the model simply no longer sees them. On Ollama the limit belongs to your server's configuration and the app cannot read it, so it cannot know when to clear automatically.

**Clear** in the chat header wipes the conversation entirely at any time and leaves a note saying so.

While the model is loading, the chat says so instead of showing the usual "Thinking" line, so a long first wait is explained rather than looking like a hang.

## Advanced settings

**Advanced** at the bottom of the assistant settings is collapsed by default. Nothing in it needs changing for normal use.

**Temperature** controls how much the model varies its wording. Leave it at 0. Testing this app's own questions against a real server, 0 answered every one correctly, while the default of higher settings got several wrong on the same questions, including reporting the total number of events when asked how many people were detected. Above 0 the assistant is more likely to state a count, a time, or a camera name that is not in the results it was given.

**Reply timeout** is how long to wait for one answer, in seconds. Raise it if your server runs the model on a processor rather than a graphics card, where a single answer can take minutes. Lower it if you would rather be told quickly that something is wrong.

**Remembered exchanges** is how many earlier questions and answers the model is shown. More helps it follow up on what you just asked. Fewer keeps each answer faster, and stops it repeating an earlier answer instead of looking again.

## Language

The assistant now understands questions in other languages: the model itself interprets your time words ("letzte Woche", "ayer por la tarde") into the exact window it looks up, and tool routing no longer depends on English keywords. English remains the best-tested path, and a few answer-accuracy safeguards (such as catching an answer that contradicts the data) only recognize English replies, so a note above the conversation says as much when the app language is not English. Replies come back in the app's language either way.

## Privacy

No third-party AI service ever sees your cameras, events, or questions. Which machines do see them depends on the backend:

- **On-device**: your questions, the answers, and anything the assistant looks up stay on your device. The only network requests are to your own ZoneMinder server, the same requests every other screen in the app makes.
- **Ollama**: the same data, plus your questions and the assistant's answers, also go to the Ollama server you configured. That server is yours; the app never sends the conversation anywhere else.

Either way the conversation is not saved. Closing zmNinjaNg clears it.

## Platform support

The on-device backend runs on desktop and in the browser, where there is enough memory to hold a model, and it needs a GPU with WebGPU support. It is not offered on phones or tablets: a mobile app is capped at far less memory than a model needs, so loading one crashes the app. Ollama has neither requirement and works anywhere the app runs, so it is the way to use the assistant on a phone or tablet, or on a desktop without WebGPU.
