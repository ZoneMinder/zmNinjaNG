# Monitors

The Monitors screen lists all cameras configured on your ZoneMinder server. Each monitor is shown as a card with a live snapshot and status.

## Monitor Cards

Each card shows:

- **Live snapshot** - A periodically refreshed image from the camera
- **Monitor name** - The name configured in ZoneMinder
- **Function** - The current monitoring mode (Monitor, Modect, Record, etc.)
- **Status** - Whether the monitor is online, in alarm, or offline
- **Event count** - Number of recent events

Tap a card to open the [Monitor Detail](#monitor-detail) view.

On desktop, hovering a monitor card for a moment opens a larger (400px wide) live preview next to the card. The preview uses its own streaming connection that is opened when the preview appears and closed the moment your cursor leaves. The underlying card remains clickable while the preview is visible.

## Filtering Monitors

Use the **Groups** selector at the top of the screen to filter by ZoneMinder monitor group. The selection persists across navigation within the same session.

To remove a monitor from this list (and from the Events and Timeline views) for the current profile, hide it from the **Hidden Monitors** section in {doc}`settings`.

## Monitor Detail

The detail view for a single monitor includes:

### Live View

A continuous live stream from the camera. The Monitor Detail page always streams, the global *Streaming Mode* setting (Streaming/Snapshot) does not apply here. The connection is closed (`CMD_QUIT` sent to ZoneMinder) when you leave the page.

The actual transport depends on your server:

- **Go2RTC streaming**: used when Go2RTC is configured on your server and enabled for the monitor. The app tries WebRTC, MSE, and HLS in parallel and uses whichever produces video first.
  - WebRTC (lowest latency)
  - MSE (Media Source Extensions)
  - HLS (HTTP Live Streaming)
- **MJPEG streaming**: used when Go2RTC is disabled, unsupported, or fails. Continuous Motion JPEG via ZoneMinder's ZMS.

If Go2RTC connects but no video frames appear within 8 seconds, the app automatically falls back to MJPEG. Monitors that fail Go2RTC are cached for 5 minutes before the app retries Go2RTC on them.

The protocol label (enabled in {doc}`settings`) shows which streaming protocol is active on each feed. The Monitor Detail page also shows native video controls (play, pause, volume) for Go2RTC streams.

For tile views (Monitors list, Montage, Dashboard widgets), the *Streaming Mode* setting does apply, see {doc}`settings` for details.

#### Scroll Pad

The live view is a zoom and pan surface, so a swipe over it zooms or pans rather
than scrolling the page. On a tablet in landscape it covers most of the screen,
leaving only thin strips at the top and bottom while the status, zones, and recent
events sit below the fold. When that happens, four buttons appear on the right
edge: jump to the top, up one screen, down one screen, and jump to the bottom.
They are the same buttons montage edit mode uses.

In portrait, or wherever the page leaves room to drag, the buttons stay away, as
they do on a computer where the wheel and the scrollbar already scroll from
anywhere.

#### Digital Zoom and Pan

The zoom controls in the corner of the live view zoom into the streamed image (this is digital zoom in the app, not camera PTZ). You can also zoom with the mouse:

- **Scroll wheel**: scroll up over the image to zoom in around the cursor, scroll down to zoom out (desktop).

Once zoomed in, you can pan the view in several ways:

- **On-screen arrows**: the directional buttons that appear next to the zoom controls when zoomed.
- **Keyboard arrow keys**: pan the zoomed view (desktop). Arrow keys only pan while zoomed in; at normal zoom they behave as usual.
- **Mouse drag**: click and drag the image to move it. The pointer shows a grab cursor when the view is zoomed.
- **Touch**: pinch to zoom, then drag with one finger to pan.

Press the reset button to return to the full, unzoomed image.

#### Per-Monitor Override

You can force MJPEG for individual monitors via the monitor's Settings dialog (Video tab). When Go2RTC is enabled for a monitor, a toggle appears to turn it off for that monitor only. See {doc}`settings` for details.

#### Always Use ZMS For Events

Some cameras record events in a video container the app cannot play. Opening one of those events loads the video, fails, shows an error, and only then switches to ZMS playback, every time.

The **Always use ZMS for events** toggle at the top of the Video tab in the monitor's Settings dialog skips that. Every event for the monitor plays through ZMS straight away, with no failed load and no error message. The toggle applies as soon as you flip it; you do not need to press Save. It is stored in the app for the current profile and changes nothing on the ZoneMinder server.

#### Show Zones

The Layers button in the live view toolbar toggles the zone overlay. When active, each detection zone is drawn as a semi-transparent polygon colored by its type: Active (green), Inclusive (blue), Exclusive (red), Preclusive (amber), Inactive (gray), Privacy (purple). A legend in the bottom-left of the player lists the types present on that monitor. Hovering a zone shows its name and type. Inactive zones appear gray.

#### Analysis Frames

The scan button in the toolbar switches the live feed from the captured image to ZoneMinder's analysis image, which draws the motion overlay the analysis daemon produces: the changed pixels it scored and the zones that fired. It is the quickest way to see whether a monitor's zones and sensitivity are set the way you meant.

The same button sits on Montage, the Monitors page, and Live Activity, and all four share one setting, so turning it on in one view turns it on in the others. The app remembers it per profile and applies it again to each stream it opens, including after a reconnect.

Three things to expect. It works on MJPEG streams only, so a monitor served over Go2RTC keeps showing the normal picture. It needs Streaming Mode set to Live; in snapshot mode the button is disabled, because ZoneMinder serves single images straight from the capture buffer and never draws the overlay on them. And a monitor whose Analysing setting is None, or one watching a still scene, looks no different, since the overlay only exists on frames where something actually moved.

### PTZ Controls

If the monitor has PTZ (Pan-Tilt-Zoom) configured in ZoneMinder, directional controls appear below the live view. Use these to pan, tilt, and zoom the camera.

### Recent Events

A list of recent events for this specific monitor, with thumbnails and timestamps. You can select and delete multiple events from this list the same way as on the main Events screen, see {doc}`events`.

### Monitor Info

Technical details about the monitor configuration (resolution, source type, function, etc.).

### Camera Credentials

The monitor's Settings dialog (Video tab) shows the camera's source path, and on ZoneMinder 1.38+ a separate username and password. On older servers the password has nowhere else to live, so it sits inside the source path itself as `rtsp://user:password@camera/stream`.

While **Disable log redaction** is off (the default), the app hides those passwords: the source path renders with the password segment replaced by dots, and the password field has no reveal button. The hostname, port, and stream path stay readable so you can still tell which camera you are looking at.

Both fields remain editable. Changing the camera's hostname while the password is masked keeps the stored password: the app puts the real value back when it saves, as long as you leave the dots alone. Type over the dots and what you typed becomes the new password.

To read a stored password, turn on **Settings → Advanced → Disable log redaction**, then turn it off again when you are done. Note that ZoneMinder's API returns these credentials to any account that can view the monitor, so hiding them in the app is not a substitute for restricting who has an account on your server.

The dialog only offers these fields to an account with the System: Edit permission. Anything less opens a read-only panel instead, with the app's own per-monitor settings and a few read-only facts, and no camera address or credentials at all. See [What your account can do](server.md#what-your-account-can-do).

## Monitor Status Indicators

| Status | Meaning |
|--------|---------|
| Green | Monitor is online and functioning |
| Red | Monitor is in alarm state |
| Gray | Monitor is disabled or offline |
| Orange | Monitor is in an error state |

## Refresh Rate

Monitor snapshots refresh automatically. The interval depends on your bandwidth setting:

- **Normal mode**: Status every 20 seconds, snapshot image every 3 seconds
- **Low bandwidth mode**: Status every 40 seconds, snapshot image every 10 seconds

See {doc}`settings` to configure bandwidth mode.
