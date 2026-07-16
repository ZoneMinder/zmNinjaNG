# Assistant

The Assistant ("Ask") answers questions about your cameras and events, and can make changes to your ZoneMinder server on request, monitors, alarms, run state, events, after you confirm each one. The model that answers is designed to run entirely on your device, not on a server operated by zmNinjaNg or anyone else.

## Enabling the Assistant

Go to **Settings > Assistant** and turn on **Enable Assistant**.

The toggle is disabled, with an explanation shown in its place, on a device or browser that does not support WebGPU. WebGPU is what lets the model run inside the app instead of on a remote server; without it there is nothing to enable yet.

## Asking a Question

Once enabled, there are three ways to start a conversation:

- Press `?` on a keyboard (desktop, web).
- Open the command palette (`/`, the sidebar button, or the mobile header icon) and tap **Ask**.
- Type a leading `?` directly into the command palette's search field.

Type your question and press Enter (or tap Send). While the assistant is working, a spinner and the name of whatever it is doing (for example, looking up an event or checking a monitor) show above the input. Tap the stop button to cancel a request in progress.

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

## The on-device model

The model runs inside the app using your device's GPU (WebGPU), the same way a game or video effect uses the GPU, rather than sending your conversation to a company's servers over the internet. **Settings > Assistant > Model** lets you pick which model to use once this is available.

:::{note}
Downloading and running the on-device model is coming in a future update. Today the toggle, model picker, and confirmation flow are all in place and functional, so you can see how the feature will work, but the Download button is disabled until the on-device model backend ships.
:::

## Privacy

The Assistant's own description of this, shown in Settings, is the short version: **runs on-device, nothing is sent anywhere except your own ZoneMinder server.**

Concretely: your questions, the assistant's answers, and any data it looks up (monitor names, event details, server health) stay on your device for the length of the conversation. The conversation is not saved once you close the app, closing zmNinjaNg clears it. The only network requests the assistant makes are the same kind of requests every other screen in the app makes, to the ZoneMinder server for the profile you are currently using. No third-party AI service ever sees your cameras, events, or questions.

## Platform support

The Assistant requires a browser or WebView with WebGPU support. Where WebGPU is unavailable, the Enable toggle in Settings stays off and explains why. Support varies by device and OS version, if the toggle is greyed out, your platform does not currently support it.
