# Ninjii, the assistant

Ninjii answers questions about your cameras and events. It is read-only: it cannot change or delete anything on your ZoneMinder server. Its event and monitor answers come with cards you tap to open that screen; Ninjii does not move the app on its own. The model that answers runs either on your device or on a server you run yourself. Nothing goes to a server operated by zmNinjaNg or any AI company.

## Enabling the Assistant

Go to **Settings > Ninjii** and turn on **Enable Ninjii**.

Underneath, **Backend** picks where the model runs:

- **Ollama**: the model runs on an [Ollama](https://ollama.com) server (or anything else speaking the OpenAI-compatible chat API) that you point the app at.
- **On-device**: the model runs inside the app on your computer's GPU, using WebGPU. Nothing leaves your device. **Desktop and web only** (see below).
- **On-device (native)**: on a supported iPhone, iPad, or Android phone, the model runs inside the app itself instead of a browser engine, using the device's GPU (Metal) on iPhone and iPad, or the CPU on Android. Nothing leaves your device. Only on a device with enough memory (see below); Android has no GPU path yet, so replies there are slower than on an iPhone.
- **On-device (Apple Intelligence)**: on an iPhone 15 Pro or newer running iOS 26 with Apple Intelligence turned on, the assistant uses Apple's own on-device system model. There is nothing to download: Apple ships and runs the model as part of iOS, so it uses none of the app's memory for model weights. Nothing leaves your device (see below).

The backends differ in how accurate their answers are, and a note under the picker says so: Ollama is the most accurate, the on-device backends (native on a phone, WebGPU on a desktop) come next, and system models such as Apple Intelligence are the least accurate. When the assistant is running on a system model, the chat window keeps a note suggesting the switch to **On-device (native)**.

The WebGPU on-device backend is not offered on phones or tablets: those models need more memory than a mobile browser engine is allowed to use, and answers take minutes on phone hardware. An iPhone or iPad with roughly 6GB of RAM or more gets the native on-device backend instead (see below). Android needs more: only a 12GB-class phone (for example a Pixel 8 Pro or a Galaxy S Ultra) qualifies, because the model runs on the CPU and its working set has to fit alongside everything else the phone is doing. An 8GB Android phone such as the Pixel 8 uses Ollama instead. Below the threshold there is no on-device choice, just a note saying so and the Ollama settings. On a desktop or in a browser, WebGPU on-device is available whenever your GPU supports WebGPU.

The chat window's header always names the model that is answering and where it runs, for example "Llama 3.2 3B · On-device" or "llama3.2:latest · Ollama", so you never have to open Settings to check which one you are talking to. On the Ollama backend a coloured dot next to that label shows whether the server is reachable: green means connected, red means it cannot be reached (check the address, or that the server is running), and a pulsing amber dot means the app is still checking. The dot rechecks periodically while the window is open. On-device has no server to reach, so no dot appears.

## Asking a Question

Once enabled, there are three ways to start a conversation:

- Press `?` on a keyboard (desktop, web).
- Open the command palette (`/`, the sidebar button, or the mobile header icon) and tap **Ask**.
- Type a leading `?` directly into the command palette's search field.

Before you have typed anything, Ninjii shows a few example prompts as tappable chips (one of them is "Summarize my day"). Tapping a chip drops its text into the input so you can send it as-is or edit it first.

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
- "Show me the most recent event on the front door camera" (tap the card in the answer to open it)

Answers come with cards underneath: event thumbnails you can tap to open the event, and monitor cards with a live preview when the answer is about a few specific cameras (a long list of monitors stays text, since every preview is a real stream). The cards are the rows the answer is about, not everything the lookup touched: ask for your busiest hour and you get that hour's events, not the whole day's.

Hover an event card's thumbnail on desktop, or long-press it on a phone or tablet, and the event plays enlarged in place, the same preview the Events list gives you. It closes when you move away or tap elsewhere, and the stream is shut down with it. Turn it off under Settings, Appearance, Hover preview, Assistant cards.

Ask it to change something, such as "arm the backyard camera" or "delete event 1234", and it will tell you it cannot and point you to the screen where you can. See below for why.

Ninjii only knows what its tools can look up: your monitors, events, groups, tags, and server health. Ask it something unrelated to this ZoneMinder server and it answers as an ordinary assistant would, without pretending to have looked anything up.

## The assistant cannot change anything

The assistant is read-only. It can look things up, and that is all. It cannot arm or disarm a monitor, trigger or cancel an alarm, change a monitor's function, change the run state, or delete or archive an event.

This is deliberate. The assistant works by having a language model choose which action matches your words, and a model can misread a request: "clear out today's events" is one phrasing away from deleting them, and "I'm home" is one phrasing away from changing your run state. Earlier versions asked you to confirm each action first, but that put the entire safeguard on a single tap, in a dialog that looks the same whether the model understood you or not. Deleting an event cannot be undone, and a monitor left disarmed records nothing.

Ask for one of these and the assistant will say it cannot do it and point you to the screen where you can: monitors and arming on **Monitors**, run state on **Server**, deleting and archiving on the event itself. Doing it there means you picked the target yourself.

## The on-device model (desktop and web)

On a desktop or in a browser, the model runs inside the app using your GPU (WebGPU), the same way a game or video effect uses the GPU, rather than sending your conversation to a company's servers over the internet. This is not available on phones or tablets; a supported iPhone, iPad, or Android phone gets its own on-device backend instead (see below), and Ollama remains the alternative everywhere.

**Settings > Ninjii > Model** shows which model runs, then **Download** fetches it. The download runs as a background task you can watch or cancel, and the model is stored on your device until you tap **Delete**.

| Model | Download | Notes |
|---|---|---|
| Llama 3.2 3B | ~2264 MB | Fastest download, smallest memory footprint. |
| Qwen3 4B | ~3432 MB | The default. Answers camera questions more accurately in testing. Needs about a gigabyte more GPU memory. |

Earlier versions offered a choice of six models. Those models varied widely in whether they would use a tool at all, so the list is now short and every entry on it is tested against the same question suite. If your settings still name a model that was removed, the app moves you to Llama 3.2 3B automatically.

The download size is a floor, not the total: running a model needs additional memory on top of its weights, and how much depends on how long the conversation gets.

:::{warning}
Local models run in your computer's memory. If the app crashes or the model never finishes loading, the machine does not have enough memory for it. Switch to the Ollama backend to run the model on a server instead. This is the same note shown next to the model picker in Settings.
:::

## The on-device model on iPhone, iPad, and Android

WebGPU on-device does not run in a mobile browser engine, but a recent iPhone, iPad, or Android phone can still run the model itself, inside the app, instead of talking to a server. **Settings > Ninjii > Backend** offers **On-device (native)** only when your device qualifies; on a device that does not, the option simply does not appear, and Ollama is the only backend shown.

Qualifying takes memory, not a particular device generation: the app checks your device's physical memory at startup. On iPhone and iPad it offers the native backend above roughly 6GB. On Android it requires a 12GB-class phone (for example a Pixel 8 Pro or a Galaxy S Ultra); 8GB Android phones, including the Pixel 8, do not qualify and use Ollama, because on Android the model runs on the CPU and its memory footprint repeatedly ran an 8GB phone out of memory during a reply. A device below the threshold never sees the option, so there is nothing to turn off if the app decides not to offer it.

iPhone and iPad run the model on the device's GPU (Metal); Android has no equivalent GPU path yet, so it runs on the CPU instead, which is noticeably slower. Set expectations accordingly: a reply that takes a couple of seconds on an iPhone can take much longer on an Android phone. Ollama stays the recommended way to run the assistant on Android when reply speed matters more than keeping the conversation fully on-device.

The model is a single fixed choice (Qwen3 4B Instruct), unlike the desktop and web picker above. **Settings > Ninjii > Model** shows its download size, about 2.5GB on both iOS and Android, and **Download** fetches it once, the same background task you can watch or cancel that other downloads use. It stays on your device until you tap **Delete**, and nothing about it changes on later app updates unless you delete and download it again.

As with WebGPU on-device, this is fully on-device: your questions, the assistant's answers, and anything it looks up on your ZoneMinder server never leave your phone or tablet except to reach that server itself. No conversation data goes to Ollama, to zmNinjaNg, or to any AI company.

## The on-device model with Apple Intelligence (iOS 26)

On an iPhone that supports Apple Intelligence, the assistant can use Apple's own on-device system model instead of a model the app ships or downloads. **Settings > Ninjii > Backend** offers **On-device (Apple Intelligence)** only when three things are true: the phone is eligible hardware (iPhone 15 Pro or newer), it runs iOS 26, and Apple Intelligence is turned on in iOS Settings. When any of these is missing the option does not appear, and the other backends are shown instead.

If your phone has Apple Intelligence hardware and iOS 26 but you have not turned Apple Intelligence on, Settings shows a short note telling you to enable it in iOS Settings. Turn it on there and the backend option appears. While iOS is still preparing Apple Intelligence after you enable it, the option stays hidden until the model is ready.

This backend is separate from **On-device (native)** above and does not share its memory requirement: a phone can offer Apple Intelligence without qualifying for the native backend, or the other way round, so each option appears on its own.

Unlike the other on-device backends, there is nothing to download and no **Model** picker: Apple manages the model as part of iOS, and it uses none of the app's memory for model weights. The model, and therefore how well it answers and which languages it replies in, is Apple's, not something zmNinjaNg selects or tunes. Everything else about the assistant works the same way.

This is fully on-device: your questions, the assistant's answers, and anything it looks up on your ZoneMinder server never leave your phone except to reach that server itself. No conversation data goes to Apple, to Ollama, to zmNinjaNg, or to any AI company.

## Running the model on your own server (Ollama)

Set **Backend** to **Ollama** and give the app the address of your server. Left empty, the app uses your ZoneMinder server's own address on port 11434, which is right when Ollama runs on that machine. The field's placeholder shows the address it will use. Type a different one if your Ollama server is elsewhere. Avoid `localhost` on a phone: there it means the phone itself, which is not running Ollama.

**Test model**, next to the model list, checks two separate things and tells you which one failed: first that the server answers at all, and then that the model you picked can call the app's tools. A model that cannot, such as gemma2, is reachable but useless here: it never looks anything up, so the assistant can only guess. A large model may take a minute to answer the first test while the server loads it into memory, and the button reports which step it is waiting on.

The model list fills in automatically from the server, and you can also type a model name by hand. A GPU-backed Ollama server is recommended, and Qwen3 8B on such a server answers noticeably better than the on-device model; Llama 3.2 is a good pick when you want the fastest possible replies. If your server does not have the recommended model, Settings shows you the `ollama pull` command to add it. The **API key** field is optional, for a server that requires one; it is stored in your device's secure storage, not alongside the rest of your settings.

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

**Temperature** controls how much the model varies its wording. Leave it at 0. Testing this app's own questions against a real server, 0 answered every one correctly, while higher settings got several wrong on the same questions, including reporting the total number of events when asked how many people were detected. Above 0 the assistant is more likely to state a count, a time, or a camera name that is not in the results it was given.

**Reply timeout** is how long to wait for one answer, in seconds. Raise it if your server runs the model on a processor rather than a graphics card, where a single answer can take minutes. Lower it if you would rather be told quickly that something is wrong.

**Remembered exchanges** is how many earlier questions and answers the model is shown. More helps it follow up on what you just asked. Fewer keeps each answer faster, and stops it repeating an earlier answer instead of looking again.

## Language

The assistant now understands questions in other languages: the model itself interprets your time words ("letzte Woche", "ayer por la tarde") into the exact window it looks up, and tool routing no longer depends on English keywords. English remains the best-tested path, and a few answer-accuracy safeguards (such as catching an answer that contradicts the data) only recognize English replies, so a note above the conversation says as much when the app language is not English. Replies come back in the app's language either way.

## Privacy

No third-party AI service ever sees your cameras, events, or questions. Which machines do see them depends on the backend:

- **On-device** (desktop and web, the native backend on iPhone, iPad, or Android, or Apple Intelligence on iOS 26): your questions, the answers, and anything the assistant looks up stay on your device. The only network requests are to your own ZoneMinder server, the same requests every other screen in the app makes.
- **Ollama**: the same data, plus your questions and the assistant's answers, also go to the Ollama server you configured. That server is yours; the app never sends the conversation anywhere else.

Either way the conversation is not saved. Closing zmNinjaNg clears it.

## Platform support

The WebGPU on-device backend runs on desktop and in the browser, where there is enough memory to hold a model, and it needs a GPU with WebGPU support. It is not offered on phones or tablets: a mobile browser engine is capped at far less memory than a model needs, so loading one crashes the app. An iPhone, iPad, or Android phone with enough physical memory gets its own native on-device backend instead (see above), with no browser engine or WebGPU involved; below that memory there is no on-device choice at all. An iPhone 15 Pro or newer on iOS 26 with Apple Intelligence turned on can additionally use Apple's on-device system model, which needs no memory of its own because iOS hosts the model (see above). Ollama has none of these requirements and works anywhere the app runs, so it is the way to use the assistant on a phone or tablet without enough memory for on-device, or on a desktop without WebGPU.

On the Linux desktop app, picking the on-device backend usually shows a "no WebGPU" note. That is not a missing GPU: Chromium ships with WebGPU turned off on Linux because Vulkan driver support there is uneven, and the app inherits that default. You can turn it on by launching the app with Chromium's own flags:

```
zmNinjaNg --enable-unsafe-webgpu --enable-features=Vulkan
```

(For the AppImage, put the flags after the AppImage file name.) This needs working Vulkan drivers, and "unsafe" is in the flag's name because Chromium has not finished hardening this path on Linux; if the app becomes unstable, drop the flags and use Ollama instead. On macOS and Windows none of this is needed, WebGPU is on by default there.
