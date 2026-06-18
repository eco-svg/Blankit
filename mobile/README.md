# Veyra Mobile (BlinkBot native, Capacitor)

Android + iOS app that wraps the live Veyra site and runs the BlinkBot GGUF
**natively** (llama.cpp) instead of WASM — same goal as `../desktop`, same
`window.BlinkNative` contract, so the web code (`blinkbot_wllama.js`) needs **no**
mobile-specific changes beyond the small `installCapacitorBridge()` shim already
in it.

```
Capacitor WebView ──loads──> https://<veyra>/pug/home   (server.url, the real site)
      │
      │ blinkbot_wllama.js sees window.Capacitor.Plugins.BlinkbotLlama
      │ → installCapacitorBridge() builds window.BlinkNative from it
      ▼
window.BlinkNative ──> BlinkbotLlama plugin (Kotlin / Swift) ──> llama.cpp (NEON / Metal / all cores)
```

If the native plugin isn't installed, `window.BlinkNative` stays undefined and
BlinkBot just runs the **WASM** path inside the WebView — so the app is usable
*before* the native plugin is finished; native is a drop-in speed upgrade.

## Phase 1 — get an installable app (WASM BlinkBot), no native plugin yet

```bash
cd mobile
npm install
npm run add:android        # and/or: npm run add:ios   (needs macOS + Xcode)
npm run sync
npm run open:android       # build & run from Android Studio
```

This already gives you a working app: it loads the live site and BlinkBot runs in
WASM. Verify it launches, logs in, and BlinkBot answers before touching native.

## Phase 2 — native llama.cpp plugin (the speed win)

Skeletons live in `native/`. The Capacitor + JNI/Swift plumbing is written; the
**llama.cpp calls are marked `TODO`** because the C API drifts between releases —
adapt them to the exact version you vendor, using the official examples:
- Android: <https://github.com/ggml-org/llama.cpp/tree/master/examples/llama.android>
- iOS: <https://github.com/ggml-org/llama.cpp/tree/master/examples/llama.swiftui>

### Android
1. Copy `native/android/BlinkbotLlamaPlugin.kt` into
   `android/app/src/main/java/com/veyra/blinkbot/`.
2. Copy `llama-jni.cpp` + `CMakeLists.txt` into `android/app/src/main/cpp/` and
   vendor llama.cpp at `cpp/llama.cpp` (git submodule).
3. In `android/app/build.gradle`: add `externalNativeBuild { cmake { path "src/main/cpp/CMakeLists.txt" } }`
   and `ndk { abiFilters "arm64-v8a" }`.
4. Register the plugin in `MainActivity.java`:
   `registerPlugin(BlinkbotLlamaPlugin.class);` (inside `onCreate`, before `super`).
5. Fill in the `TODO(llama.cpp)` blocks in `llama-jni.cpp`, build, run on a device.

### iOS (needs macOS + Xcode)
1. Copy `native/ios/BlinkbotLlamaPlugin.swift` into the `ios/App` project.
2. Vendor llama.cpp (SwiftPM package or a prebuilt `.xcframework` with Metal).
3. Fill in the `TODO(llama.cpp)` blocks, build, run on a device.

## Verify (per platform, on a real device)

1. App launches and loads `/pug/home`.
2. With the native plugin present, opening BlinkBot logs that `window.BlinkNative`
   is active (it routes load+generate to the plugin, not WASM).
3. First run downloads the GGUF once (progress bar), then loads natively.
4. A message streams tokens into the card; the parsed action reaches the server.
5. Inference is clearly faster than the WASM build on the same device.

## Notes
- `appId` / `appName` live in `capacitor.config.json`; it points `server.url` at
  production — change it (or use a local LAN IP) to test against a dev server.
- Capacitor needs a local `webDir`, so `www/index.html` exists as a placeholder;
  the app navigates to `server.url` on launch.
- Raw user text crosses only the in-process plugin bridge to local llama.cpp — it
  never leaves the device, same on-device promise as the browser/desktop builds.
