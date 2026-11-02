# YouTube Face Blur

A browser extension that watches the YouTube or Hotstar video you're playing,
checks it about once a second for faces, and blurs the video whenever a face
matching your chosen gender is detected. Pick "Men", "Women", or "Everyone"
from the popup. Everything runs **on-device** in the browser — no server, no
data ever leaves your machine.

## ⚠️ About "supports mobile" — read this first

Browser extensions and mobile browsers don't mix the way you might expect:

- **Chrome / Safari on Android or iOS do not support extensions at all.**
  There is no way to install this (or any) extension there.
- **Firefox for Android is the only realistic mobile option.** It supports
  regular WebExtensions like this one, but normally only extensions listed on
  addons.mozilla.org. To sideload an unlisted extension like this one, you
  need Firefox Nightly/Beta and enable a "Custom Add-on Collection" (or
  publish it to AMO as "unlisted" and install via a direct link).
- The code below is written as a standard WebExtension (Manifest V3), so the
  **same files work on both Chrome/Edge/Brave desktop and Firefox
  desktop/Android** — nothing mobile-specific needs to change in the code
  itself. The limitation is entirely about how each mobile browser allows
  extensions to be installed, not about this extension's capabilities.

So: build once, and desktop just works. For phones, your realistic path is
Firefox for Android with sideloading enabled.

## What you're getting

```
blur-extension/
├── manifest.json      # Manifest V3 config
├── background.js      # sets default settings on install
├── content.js         # the actual detection + blur logic
├── content.css         # styling for the small "Blurred" badge
├── popup.html / popup.js  # toolbar popup to toggle on/off, tune sensitivity
├── icons/              # placeholder icons (swap these for your own)
├── lib/                 # ⬅ you need to add two files here (see below)
└── models/               # ⬅ you need to add model weight files here (see below)
```

## 1. Add face-api.js (required — not included)

Manifest V3 extensions aren't allowed to load remote scripts, so the library
has to be bundled locally. I don't have internet access in this environment
to fetch it for you, so:

1. Download **face-api.min.js** and **tf.min.js** (its TensorFlow.js
   dependency) from the face-api.js project:
   - https://github.com/justadudewhohacks/face-api.js (see `dist/` folder,
     or use the CDN copy at `https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js`
     and `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.2.0/dist/tf.min.js`
     — download these files, don't reference the CDN directly)
2. Save them into `lib/` as `lib/face-api.min.js` and `lib/tf.min.js`.

## 2. Add the model weights (required — not included)

face-api.js needs two pretrained models:

- `tiny_face_detector` — finds faces
- `age_gender_model` — classifies age + gender

Download the weight files (the `*-shard1` + `*-weights_manifest.json` files)
from the face-api.js `weights` folder:
`https://github.com/justadudewhohacks/face-api.js/tree/master/weights`

You need these 6 files, placed directly in `models/`:
```
tiny_face_detector_model-weights_manifest.json
tiny_face_detector_model-shard1
age_gender_model-weights_manifest.json
age_gender_model-shard1
```

## 3. Load the extension

**Chrome/Edge/Brave (desktop):**
1. Go to `chrome://extensions`
2. Turn on "Developer mode" (top right)
3. Click "Load unpacked" and select the `blur-extension` folder

**Firefox (desktop):**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `manifest.json` inside the folder

**Firefox (Android)** — see the mobile caveat above; once sideloading is
enabled, install the same package via a Custom Add-on Collection.

## How it works

- `content.js` runs on YouTube and Hotstar pages, finds the `<video>` element,
  and checks it about once per second. Thumbnail detection is YouTube-only.
- `face-api.js`'s TinyFaceDetector finds faces in that frame; its
  age/gender model classifies each face.
- If any detected face is "male" above your confidence threshold, the real
  `<video>` element gets `filter: blur(...)` applied directly — this is much
  simpler and more robust than overlaying a separate canvas, and it doesn't
  interfere with YouTube's play/pause/seek controls since those live outside
  the video element.
- Matching faces in visible YouTube thumbnails receive the same blur directly
  on their image elements. Newly loaded thumbnails are picked up on the next
  check; Hotstar thumbnails are not scanned.
- The popup (click the extension icon) lets you toggle it on/off and tune:
  video detection, thumbnail detection, gender-confidence threshold, blur
  strength, and how often it checks.

## Known limitations (be aware of these)

- **Gender classification from a face crop is inherently imperfect.** Expect
  misfires — side angles, low light, sunglasses, partial faces, and
  ambiguous framing will all trip it up in both directions.
- Detection runs on a downscaled frame for speed, so very small or distant
  faces may be missed.
- It only "sees" one frame per interval, so a face that appears and
  disappears between checks may be missed.
- Hotstar may use DRM-protected playback. If the browser does not expose the
  video frames to canvas, face detection cannot run on that stream.
- Model files add ~15-20MB to the extension package — that's normal for a
  browser-based ML model.

## Tuning tips

- If it's blurring too often (false positives), raise "Gender confidence" in
  the popup.
- If it's missing men entirely, lower "Gender confidence" or shorten the
  check interval.
- Lower `sampleWidth` in `content.js` if detection feels slow on your
  machine; raise it if faces are too small to detect reliably.
