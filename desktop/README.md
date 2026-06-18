# Veyra Desktop (BlinkBot native)

A thin Electron shell around the live Veyra site whose **only job** is to run the
BlinkBot model **natively** instead of in WASM.

In the browser, BlinkBot runs the 0.5B GGUF through `wllama` (llama.cpp compiled
to WebAssembly): one address space, no GPU, capped at WASM's ~4 GB and roughly
the speed of a single SIMD lane × a few worker threads. This shell loads the
*same* GGUF through **real llama.cpp** via [`node-llama-cpp`], which:

- uses **Metal** on macOS, **CUDA / Vulkan** on Windows & Linux when a GPU is present,
- otherwise uses **all CPU cores**,
- and addresses **full system RAM**.

So it genuinely scales with the machine — a decent desktop is several times
faster than the browser path. That is the "faster according to the device's
resources" win.

> **Scope:** desktop first (Windows / macOS / Linux). Mobile (Android, then iOS)
> is the next phase and uses a *separate* Capacitor wrapper + a native plugin —
> Capacitor does **not** cover desktop, which is why this is its own Electron app.

## How it fits together

```
Electron window  ──loads──>  https://<veyra>/pug/home   (the real site, unchanged)
      │
      │ preload.js injects window.BlinkNative
      ▼
blinkbot_wllama.js sees BlinkNative.available  ──>  routes load + generate to it
      │ (in a plain browser this is undefined → falls back to wllama/WASM)
      ▼
preload.js  ──IPC──>  main.js  ──>  llm.js  ──>  node-llama-cpp (native llama.cpp)
```

The renderer (`distro/pug/static/blinkbot_wllama.js`) is the single source of the
prompt: it hands `BlinkNative` the **same** `messages` array and options it would
hand `wllama`, so the model sees byte-identical input to the web path and the
fine-tune. No behaviour drift between web and desktop.

Raw user text crosses only the in-process bridge to local llama.cpp — it never
leaves the machine, same on-device promise as the browser.

### Files
| file | role |
|------|------|
| `main.js`    | Electron main: window, IPC handlers, owns the model |
| `preload.js` | exposes `window.BlinkNative` (mirrors the wllama API we use) |
| `llm.js`     | native inference: download GGUF once, load, generate (streaming) |

The web-side hook lives in `distro/pug/static/blinkbot_wllama.js` (`nativeLLM()`
+ the native branches in `ensureEngine` / `startDownload`). It is additive and a
no-op in normal browsers.

## Prerequisites

- **Node 20+** and npm.
- Build toolchain for the native module (only needed if a prebuilt binary isn't
  available for your platform; `node-llama-cpp` ships prebuilts for the common ones):
  - **Windows:** Visual Studio Build Tools (Desktop C++), CMake.
  - **macOS:** Xcode command-line tools (`xcode-select --install`).
  - **Linux:** `base-devel` + `cmake` (Arch/CachyOS) or `build-essential` + `cmake` (Debian-ish).
    - **GPU for inference:** node-llama-cpp uses **Vulkan** on Linux (or **CUDA** on NVIDIA). On CachyOS install the Vulkan loader + your driver's ICD — `vulkan-radeon`/`vulkan-intel` (Mesa) or `nvidia-utils` — and `vulkan-tools` (`vulkaninfo` to confirm). No GPU/driver → it just uses all CPU cores.
    - **Wayland / Hyprland:** `main.js` already passes `--ozone-platform-hint=auto`, so Electron runs natively on Wayland (crisp on fractional scaling) and falls back to X11 on X sessions. If you ever hit a rendering glitch on a specific compositor, force it with `ELECTRON_OZONE_PLATFORM_HINT=auto` (native) or `=x11` (XWayland fallback).

## Run (dev)

```bash
cd desktop
npm install
npm start                 # points at production (https://veyra-bmzb.onrender.com/)
# or, against a local Flask dev server:
npm run start:local       # BLINK_APP_URL=http://localhost:5000
```

Point it anywhere with `BLINK_APP_URL=<origin> npm start`.

On first launch, opening BlinkBot downloads the GGUF once to the app's userData
dir (`…/Veyra/blinkbot/model.gguf`) from `<origin>/pug/api/blinkbot/model.gguf`,
then loads it natively. Subsequent launches load straight from that cache.

## Build installers

```bash
npm run dist            # current OS
npm run dist:win        # NSIS .exe
npm run dist:mac        # .dmg
npm run dist:linux      # AppImage
```

(Cross-building for other OSes generally requires running on that OS or a CI
matrix — `electron-builder` can't produce a signed mac build from Linux, etc.)

## Status / not yet verified

This scaffold was written without a local Electron build available, so the
following still need a real run on a dev machine:

1. `npm install` succeeds and `node-llama-cpp` resolves a prebuilt (or compiles).
2. The window loads `/pug/home` and BlinkBot detects `window.BlinkNative`.
3. First-run model download + native load shows the progress bar and reaches "Ready."
4. A real message streams tokens into the card and the parsed action hits the server.
5. GPU is actually engaged (check `node-llama-cpp` logs for the chosen backend).

If `node-llama-cpp`'s streaming option names differ in your installed version,
the one place to adjust is `llm.js` → `generate()` (the `onResponseChunk` /
`maxTokens` / `temperature` option names).

[`node-llama-cpp`]: https://node-llama-cpp.withcat.ai/
