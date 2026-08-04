# Profiles

Profiles store connection details for your ZoneMinder servers. You can create multiple profiles to switch between different servers or accounts.

## Adding a Profile

1. Open zmNinjaNg, if no profile exists, you'll land on the Profiles screen
2. Tap **Add Profile**
3. Fill in the connection details:

| Field | Description | Example |
|-------|-------------|---------|
| **Name** | A label for this profile | "Home Cameras" |
| **Portal URL** | Your ZoneMinder server URL | `https://zm.example.com/zm` |
| **Username** | ZoneMinder login username | `admin` |
| **Password** | ZoneMinder login password | |

4. Tap **Test Connection** to verify the credentials and API access
5. Tap **Save**

:::{tip}
The Portal URL should point to the base ZoneMinder web path, typically ending in `/zm`. zmNinjaNg will auto-discover the API endpoint from there.
:::

## QR Code Import

When adding a profile, tap the **Scan QR Code** button to populate the form by scanning a QR code that contains profile data. This avoids retyping the URL, username, and password on a new device.

The profile data (including password) is transferred via the QR code. No data is sent over the network during this process.

## Switching Profiles

If you have multiple profiles, tap on a profile card to switch to it. The app will reconnect to the selected server.

## All Servers Mode

Once you have two or more profiles that aren't disabled, an **All Servers** card appears at the end of the profile list, with a note that aggregating every server can be resource-heavy. Tap it to switch into a combined view that pulls from every enabled profile at once instead of a single server. Dropping back below two enabled profiles removes the card again.

All Servers mode aggregates Monitors, Montage, Events (including its montage/grid view), Timeline, Dashboard, and Live Activity. The Monitors and Montage screens show every camera from every profile, and each card or tile carries a chip naming the server it came from; Montage caps the total number of live streams it opens at once, so a large combined camera count doesn't try to open every stream from every server simultaneously. A toggle at the top of Monitors groups the cards by server instead of one flat list. Events and Timeline merge every profile's history into one list, grid, or canvas, sorted by actual time across servers in different timezones, and each event carries the same server chip. If a server is unreachable while others respond, its data is skipped and an error strip with a retry button appears for it; data from every reachable server still shows. Tapping a monitor or event opens its detail directly, without switching the active profile first, and a push notification for any known server's event opens straight to that event the same way. The notification bell badge and its history sum every profile's own unread count and events while in All Servers mode. The app also remembers the last page you were on separately for All Servers mode and for each profile, so switching into All Servers mode returns you to wherever you last left it there, not wherever the profile you switched from was showing.

Live Activity aggregates the same way: every enabled profile's watched monitors feed the same alarm grid, each tile carrying its server chip. The total number of monitors watched at once across every server is capped, drawn evenly round-robin from each profile so one busy server can't crowd the rest out; hitting the cap shows an overflow line reporting how many monitors aren't being watched. The page's poll interval, dwell time, and tile count stay one All Servers-wide setting, same as its other preferences, but which monitors to watch is still a per-server list - the settings dialog's ignore-list section gets its own profile picker in All Servers mode so you can edit one server's watch list at a time.

Screens that are inherently tied to one server - Logs, Server, Notification settings, and the server-scoped part of Settings - show a profile picker instead: pick which server's data that screen displays, defaulting to the first profile in scope. The AI assistant works the same way: in All Servers mode it pins itself to one profile (shown in a banner above the chat, with its own picker to change it), since an answer about "the front door" is meaningless without knowing which server it came from.

Notification Settings adds more than just the picker while aggregating: an overview lists every profile's own notification mode and live connection status, since each server keeps its own configuration and there's no shared config to edit. A single **All-mode notifications** setting controls the aggregate connections themselves: **Live** connects every server and shows toasts and sound as they arrive; **Muted** keeps every server connected and keeps the badge and history updating, but suppresses toasts and sound; **Off** doesn't connect any server while aggregating, so nothing updates until you switch it back. In Live or Muted mode, events arriving close together from different servers coalesce into one summary toast instead of one per event, and toast and sound behavior still honors each server's own settings underneath that. On mobile, push notifications are unaffected - Firebase Cloud Messaging already delivers every profile's events regardless of which one is active, so All Servers mode doesn't open extra connections there.

Preferences are two-tier: All Servers mode has its own settings (grid layout, feed fit, and so on), kept separate from each individual profile's settings. A change made while in All Servers mode does not touch any single profile's settings, and vice versa. This covers what you are looking at rather than how a server is reached, so while aggregating, one analysis-frames setting governs every tile no matter which server it came from. Timeouts, ports and other connection settings still belong to each server.

Streaming Mode gets a third option while aggregating. An **All Servers Streaming Mode** row appears at the top of Settings, above the per-server picker: leave it on **Per server** and each server's tiles keep following that server's own Streaming Mode, or pick **Streaming** or **Snapshot** to impose one choice on every tile from every server. Per server is the default, so switching into All Servers mode never changes how anything streams until you ask it to.

## Editing a Profile

Tap the edit icon on a profile card to modify the connection details. You can change the URL, credentials, or display name.

## Disabling a Profile

Tap the power icon on a profile card to disable it without deleting it. A disabled profile stays listed, greyed out with a **Disabled** badge, but can't be switched to and drops out of every All Servers mode aggregate, including the count that decides whether the All Servers card is shown at all. Tap the icon again to re-enable it.

## Deleting a Profile

Tap the delete icon on a profile card. You'll be asked to confirm before the profile is removed.

## Security

Passwords are encrypted at rest:

- **Web/Desktop**: AES-256-GCM encryption with PBKDF2 key derivation (100,000 iterations)
- **Android**: Hardware-backed encryption via Android Keystore
- **iOS**: Keychain storage

Passwords are never stored in plaintext.

## Troubleshooting

**"Connection failed"**
- Verify the Portal URL is correct and accessible from your device
- Check that ZoneMinder API is enabled (`OPT_USE_API = 1` in ZoneMinder options)
- If using a self-signed certificate, enable **Allow self-signed certificates** in Settings > Advanced (or toggle it when adding the profile)
- On Android, if only the LAN address fails while a remote URL works, the device may be withholding local network permission, see {doc}`faq`

**"Authentication failed"**
- Verify username and password
- Check that the user has API access permissions in ZoneMinder
