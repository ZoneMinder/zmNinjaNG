# Experiences in migrating zmNinja from AngularJS to React

[zmNinja](https://zmninja.zoneminder.com/) is a popular cross platform app (Desktop/iOS/Android) for [ZoneMinder](https://zoneminder.com/) (Open Source Home Security System) with 1M+ users. I built this over a couple of years. It is built with AngularJS, ionicv1 and cordova. These technologies have long been deprecated and its been a pain to keep the app updated. I have since moved on from thep project and the developers of ZoneMinder have found it to be hard to maintain.

Over the last 2 days, I used Claude CLI to refactor the old zmNinja to zmNg - a complete ground up rewrite of the old zmNinja to a modern react based ecosystem. 

## Quick summary of Before/After

Refer to more detailed information [here](COMPARISON.md)

Overall, zmNinja was a massive monolith with repeated code that grew over time. I had no time to re-write it. Claude did an excellent job modularizing and completely rewriting it

| Metric | zmNinja | zmNg | Reduction |
|--------|---------|------|-----------|
| **JavaScript/TypeScript** | ~28,000 LOC | ~11,014 LOC | **61% less** |
| **Templates/JSX** | ~3,000 LOC | (integrated) | Unified |
| **Styles (CSS/SCSS)** | ~650 LOC | ~300 LOC | **54% less** |
| **Total Source Code** | **~31,650 LOC** | **~11,314 LOC** | **65% less** |
| **Source Files** | 79 files | 67 files | **15% fewer** |
| **Cordova/Capacitor Plugins** | 26 plugins | 2 plugins | **92% fewer** |


## How I approached it

zmNinja is a reasonably complex app. It handles video streams (MJPEG, HLS, other formats), deals with goofy ZoneMinder nuances (CakePHP API) , has to deal with multi-profile cache/state management, does multi-channel notifications, has multiple views with drag&drop and more. ZoneMinder itself is a full featured NVR system that handles multi-server situations that requires clients to adapt. Further, MJPEG and Single Page Apps (SPAs) have a painful memory management issue where streams continue to operate when views change, causing memory build up. 

So here is what I did:
- I wrote up a [instruction set](../CLAUDE.md) to get it started, which essentially described the problems with zmNinja
- I also downloaded the [ZM API documents](https://zoneminder.readthedocs.io/en/latest/api.html), and the old[zmNinja code](https://github.com/ZoneMinder/zmNinja)
- I then asked the agent to refactor and asked it to make its own tech stack choice. I was quite happy with the choices (reactive/capacitor)

## Horse-Racing Anti Gravity (Gemini3) and Claude CLI (Auto models)

AntiGravity (AG) is the new Google IDE that was launched a few weeks ago. It seems to be based off WindSurf but adds some interesting integrated UI tests that are useful for UI heavy apps. Given zmNinja is very heavy on UI, I wanted to see how AG would measure up

| Activity | Claude CLI | Anti-Gravity (AG) | Winner |
|----------|------------|-------------------|--------|
| Initial framing | Claude did an excellent job setting up a layout of the app. It did not work out of the box, but after maybe 30 mins of tuning/pasting error logs, I had around 50% of the app functionality baked in. Even though I asked it to deep dive into my old code and extract all the functionality, it picked up the main ones (montage/monitors/settings/events) but not the nuanced ones like timeline/etc | I passed the same instructions to AG. It also selected react, but went with some other choices for the desktop stack - forgot. Overall, I spent around an hour trying to get it to work but I kept getting error after error. Gave up | Claude |


