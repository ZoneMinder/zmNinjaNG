# Events

The Events screen lets you browse and play back recorded events from your ZoneMinder server.

## Event List

Events are displayed as cards showing:

- **Thumbnail** - A snapshot from the event
- **Monitor name** - Which camera captured the event
- **Date and time** - When the event occurred
- **Duration** - Length of the event
- **Frames** - Number of frames in the event
- **Tags** - Any tags applied to the event in ZoneMinder

Events from the last 7 days also show how long ago they occurred, displayed next to the date and time.

Older events load automatically as you scroll.

On desktop, hovering over a thumbnail for a moment shows a 400px-wide preview anchored next to the row. The preview loads a higher-resolution image from the server. The underlying card remains clickable while the preview is visible, so you can still click to open the event.

## Deleting Multiple Events

Each event card has a trash icon. Tap it to queue that event for deletion without opening it, the card dims and tints red to show it is selected. Tap the icon again to remove it from the selection.

Once at least one event is selected, a floating bar appears showing how many events are queued (for example, "Delete 3 events"), with **Cancel** and **Delete** buttons:

- **Cancel** - Clears the selection without deleting anything
- **Delete** - Permanently deletes all selected events from your ZoneMinder server

Deletion is permanent and cannot be undone. If some events fail to delete (for example, a server error), the app shows an error and leaves the successful ones deleted.

The same selection and delete flow is available in the Recent Events list on a monitor's detail page.

## Filtering Events

Filter events using the controls at the top:

- **Date range** - Select a start and end date
- **Monitor** - Show events from a specific camera only
- **Groups** - Filter by monitor group
- **Favorites only** - Show only events you have starred. This works across all your favorites, including ones older than the first page of results.
- **Tags** - Show only events carrying the tags you pick (if your server supports tags). Select several tags to see events with any of them, or "All" for events with any tag. Like favorites, this covers tagged events older than the first page.
- **Archived only** - Restrict the list to archived events. To archive an event, open it in the event detail screen and use the archive action.

## Event Playback

Tap an event to open the event detail view, which includes:

### Video Player

The event player selects the playback mode based on the event's format:

- **HLS events** - Events with an `.m3u8` DefaultVideo use HLS playback via video.js
- **MP4 events** - Events with MP4 recordings use standard video playback

If video.js playback fails (network error, unsupported codec, etc.), the player automatically falls back to ZMS playback, which streams JPEG frames from ZoneMinder.

#### ZMS Fallback

ZMS playback renders frames one at a time from ZoneMinder's streaming server. Controls include:

- **Play/Pause** - Start or stop frame-by-frame playback
- **Seek** - Jump to any point in the event
- **Playback speed** - Adjust speed

#### Standard Controls

For video-based playback (HLS or MP4), the player provides:

- **Play/Pause** - Start or stop playback
- **Scrub bar** - Jump to any point in the event
- **Playback speed** - Adjust speed (1x, 2x, etc.)

### Event Info

Details about the event:

- Start and end time
- Duration
- Number of alarm and total frames
- Monitor name and ID

### Navigation

- **Previous/Next** buttons to move between events without going back to the list

## Event Montage

View events from multiple cameras at the same time, useful for reviewing an incident across several camera angles.

## Downloads

You can download event recordings:

1. Open an event
2. Tap the download button
3. The video file is saved to your device

On mobile, downloads go to the device's Documents or Downloads folder. A progress indicator shows status.

:::{note}
Downloads run in the background, you can continue using the app.
:::
