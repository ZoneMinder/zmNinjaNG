# Live Activity

Live Activity shows only the cameras that ZoneMinder currently reports as alarming, as live video tiles. Instead of scanning a full grid of quiet monitors, you see just the ones that need attention right now.

## Why a monitor lingers after its alarm clears

A monitor does not disappear the instant its alarm clears. It stays on screen for a short dwell window (30 seconds by default) after its last alarm, then leaves. This is not just to avoid a jarring flicker: each tile that appears or disappears opens or closes a live video connection to the server. A monitor that flickered in and out of alarm every few seconds would open and close that connection just as fast, which is unnecessary load on the server. The dwell window smooths that out.

Any new alarm during the dwell window resets the timer and keeps the tile on screen.

## Reading a tile

Each tile header shows an icon for the monitor's current state next to the camera name: a siren while it is alarming, a warning triangle just after, and an hourglass while it is cooling down toward leaving the page. Hover the icon, or read it with a screen reader, to get the state in words. A tile that has stopped alarming also dims while its dwell window runs out.

## Order and overflow

The camera that alarmed most recently sits at the top, and the ones that have gone quiet sink toward the bottom as they cool. Two cameras that alarm in the same check keep a fixed order between them rather than swapping around. Tiles slide to their new positions where your browser supports it, so a reorder is visible rather than an instant jump. If more monitors are alarming than the page can show, the extra ones collapse into a "+N more active" line instead of overcrowding the grid, which means the tiles you keep are the most recent activity.

## Settings

Open the gear icon at the top of the page to configure:

- **Check every**: how often, in seconds, the page checks each watched monitor's alarm state. Low bandwidth mode raises the minimum you can set here.
- **Keep on screen for**: the dwell window described above, in seconds. Raise it if tiles disappear and reappear too often; lower it to clear tiles faster once an alarm ends. The minimum is 5 seconds, because a zero-second window is what the dwell window exists to prevent.
- **Maximum tiles**: how many tiles the grid shows at once before the rest collapse into the overflow count.
- **Monitors to watch**: a per-monitor switch that keeps a monitor off this page only. It stays visible everywhere else in the app. This is separate from the hidden monitors list in {doc}`settings`, which hides a monitor from the whole app.

A monitor set to record continuously starts switched off here, and its row says so. A camera that always records is always inside an event, so it would sit on this page permanently and push out whatever is actually alarming. Switch one back on if you do want to watch it; that choice is remembered separately from the monitors you turned off yourself.

A push notification for a monitor promotes it onto the page immediately, rather than waiting for the next scheduled check.

## When the server cannot be reached

While the page is waiting for its first answer it shows placeholder tiles, and if it cannot reach the server it shows the error instead of the "All quiet" message. "All quiet" means the server was asked and said nothing is alarming, so the page never shows it on a guess.

A monitor whose check fails keeps the last alarm state the server reported, rather than dropping off the page. A single dropped request on a weak connection therefore does not end an alarm and restart it as a new one.
