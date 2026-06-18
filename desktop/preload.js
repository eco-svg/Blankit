/* ═══════════════════════════════════════════════════════════════════════════
   preload.js — exposes window.BlinkNative to the Veyra page.

   The shape deliberately mirrors the slice of the wllama API that
   blinkbot_wllama.js actually uses (load + createChatCompletion), so the
   renderer can treat the native engine as a drop-in: set `wllama = BlinkNative`
   and the existing warmUp / processInput code paths work unchanged.

   Raw user text crosses only this in-process bridge to the local llama.cpp — it
   never leaves the machine, exactly like the on-device WASM promise.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('BlinkNative', {
  available: true,

  // load({ systemPrompt, contextSize, onProgress }) — downloads (once) + loads
  // the GGUF natively. onProgress({ loaded, total }) mirrors wllama's callback.
  load: ({ systemPrompt, contextSize, onProgress }) => {
    const onProg = (_e, p) => { if (onProgress) onProgress(p); };
    ipcRenderer.on('blink:load-progress', onProg);
    return ipcRenderer.invoke('blink:load', { systemPrompt, contextSize })
      .finally(() => ipcRenderer.removeListener('blink:load-progress', onProg));
  },

  // createChatCompletion(messages, opts) — same signature wllama exposes.
  // Streams tokens to opts.onNewToken(_, _, currentText) and resolves with the
  // full output string. opts.abortSignal aborts the native run.
  createChatCompletion: (messages, opts = {}) => {
    let running = '';
    const onTok = (_e, delta) => {
      running += delta;
      if (opts.onNewToken) opts.onNewToken(null, null, running);
    };
    ipcRenderer.on('blink:token', onTok);

    if (opts.abortSignal) {
      opts.abortSignal.addEventListener('abort', () => ipcRenderer.send('blink:abort'), { once: true });
    }

    return ipcRenderer.invoke('blink:generate', {
      messages,
      nPredict: opts.nPredict,
      temp: opts.sampling && opts.sampling.temp,
    }).finally(() => ipcRenderer.removeListener('blink:token', onTok));
  },
});
