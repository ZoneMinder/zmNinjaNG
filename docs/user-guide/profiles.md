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

Once you have two or more profiles, an **All Servers** card appears above the profile list. Tap it to switch into a combined view that pulls from every profile at once instead of a single server. A single profile drops the app back below two and the card disappears again.

In v1, All Servers mode aggregates monitors only. The Monitors screen shows every camera from every profile, and each card carries a chip naming the server it came from. A toggle at the top of the screen groups the cards by server instead of one flat list. If a server is unreachable while others respond, its cameras are skipped and an error strip with a retry button appears for it; cameras from every reachable server still show.

Preferences are two-tier: All Servers mode has its own settings (grid layout, feed fit, and so on), kept separate from each individual profile's settings. A change made while in All Servers mode does not touch any single profile's settings, and vice versa.

Other screens - Dashboard, Events, Timeline, Montage, and so on - don't support All Servers mode yet and show no data while it's active. Switch back to a single profile, either from the Profiles screen or the profile switcher, to use them.

## Editing a Profile

Tap the edit icon on a profile card to modify the connection details. You can change the URL, credentials, or display name.

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
