/* ═══════════════════════════════════════════════════════════════════════════
   main.js — Electron main process for the Veyra desktop shell.

   It loads the live Veyra site in a window, but injects a preload that exposes
   window.BlinkNative. When BlinkBot's runtime sees that bridge, it routes the
   GGUF through NATIVE llama.cpp (this process, via llm.js) instead of WASM.
   Everything else on the site is unchanged — this shell only accelerates the
   on-device model.

   Point it at a different origin with the BLINK_APP_URL env var (the
   `npm run start:local` script aims it at http://localhost:5000).
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const llm = require('./llm');

const APP_URL = process.env.BLINK_APP_URL || 'https://veyra-bmzb.onrender.com/';

// Linux/Wayland (e.g. Hyprland on CachyOS): run natively on Wayland when it's
// present instead of falling back to XWayland — that fixes blurry HiDPI /
// fractional scaling and input quirks. 'auto' still picks X11 on X sessions,
// and the switch is a harmless no-op on Windows/macOS.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

let win = null;
let currentAbort = null;   // the in-flight generation's controller (UI runs one at a time)

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 820,
    backgroundColor: '#0e0f13',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,            // preload needs Node (ipcRenderer + contextBridge)
    },
  });
  win.loadURL(`${APP_URL.replace(/\/$/, '')}/pug/home`);
}

// ── IPC: the bridge the renderer talks to ─────────────────────────────────────

// Load the engine once. Progress is streamed back so the card shows the same
// "Loading model… NN%" bar as the web build.
ipcMain.handle('blink:load', async (e, { systemPrompt, contextSize }) => {
  await llm.load({
    appUrl: APP_URL,
    userDataDir: app.getPath('userData'),
    systemPrompt,
    contextSize,
    onProgress: (p) => { if (!e.sender.isDestroyed()) e.sender.send('blink:load-progress', p); },
  });
  return true;
});

// One generation. Tokens stream over 'blink:token'; the call resolves with the
// full text (which the renderer parses exactly like wllama's return value).
ipcMain.handle('blink:generate', async (e, { messages, nPredict, temp }) => {
  currentAbort = new AbortController();
  try {
    return await llm.generate({
      messages, nPredict, temp,
      signal: currentAbort.signal,
      onToken: (delta) => { if (!e.sender.isDestroyed()) e.sender.send('blink:token', delta); },
    });
  } finally {
    currentAbort = null;
  }
});

// Renderer's AbortSignal can't cross IPC, so it sends this when its timeout fires.
ipcMain.on('blink:abort', () => { if (currentAbort) currentAbort.abort(); });

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
