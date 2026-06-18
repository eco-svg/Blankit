/* ═══════════════════════════════════════════════════════════════════════════
   llm.js — native llama.cpp backend for the desktop shell.

   This is the whole point of the desktop build: instead of running the GGUF in
   WASM (single address space, no GPU, capped), node-llama-cpp loads it through
   real llama.cpp — Metal on macOS, CUDA/Vulkan on Windows/Linux when present,
   all CPU cores otherwise, and full system RAM. So it genuinely scales with the
   machine: a beefy desktop is several times faster than the browser path.

   The renderer (blinkbot_wllama.js) sends the SAME messages array and options it
   would hand wllama, so the prompt the model sees is byte-identical to the WASM
   path and to the fine-tune — no behaviour drift between web and desktop.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// node-llama-cpp v3 is ESM-only; we're CommonJS, so import it lazily.
let _mod = null;
async function mod() {
  if (!_mod) _mod = await import('node-llama-cpp');
  return _mod;
}

let llama = null;     // backend handle (picks GPU/CPU automatically)
let model = null;     // loaded GGUF
let context = null;   // KV context
let session = null;   // chat session (carries the system prompt)

// Where the model lives on disk. main.js downloads it here once (same bytes the
// web app serves at /pug/api/blinkbot/model.gguf), then we load from cache.
function modelPath(userDataDir) {
  return path.join(userDataDir, 'blinkbot', 'model.gguf');
}

// Download the GGUF to the local cache if it isn't there yet. `onProgress`
// receives { loaded, total } so the renderer can show the same % bar as wllama.
async function ensureModelFile(appUrl, userDataDir, onProgress) {
  const dest = modelPath(userDataDir);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const url = `${appUrl.replace(/\/$/, '')}/pug/api/blinkbot/model.gguf`;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model download failed: HTTP ${res.status}`);

  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  let loaded = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.length;
    out.write(Buffer.from(value));
    if (onProgress) onProgress({ loaded, total });
  }
  await new Promise((r, j) => out.end(err => (err ? j(err) : r())));
  fs.renameSync(tmp, dest);   // atomic: a half-download never looks complete
  return dest;
}

// Load (or reuse) the engine. `systemPrompt` seeds the chat session; we keep the
// session stateless per message (history reset each generation) to mirror the
// WASM path, which sends only system + the current user turn every time.
async function load({ appUrl, userDataDir, systemPrompt, contextSize = 2048, onProgress }) {
  if (session) return;
  const { getLlama, LlamaChatSession } = await mod();

  const file = await ensureModelFile(appUrl, userDataDir, onProgress);

  llama = await getLlama();                      // auto-selects Metal/CUDA/Vulkan/CPU
  model = await llama.loadModel({
    modelPath: file,
    // Use every GPU layer the device can fit; node-llama-cpp falls back to CPU
    // for whatever doesn't fit, so this is safe on machines with no/weak GPUs.
    gpuLayers: 'auto',
    onLoadProgress: (p) => onProgress && onProgress({ loaded: p, total: 1, loadingIntoMemory: true }),
  });
  context = await model.createContext({
    contextSize,
    threads: Math.max(2, os.cpus().length),       // all cores for prompt eval
  });
  session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt,
  });
}

// One generation. `messages` is wllama's array ([{role,content}…]); we read the
// system + latest user turn from it so the renderer stays the single source of
// the prompt. `onToken(text)` streams the running output; `signal` aborts.
async function generate({ messages, nPredict = 200, temp = 0.1, onToken, signal }) {
  if (!session) throw new Error('engine not loaded');

  const user = [...messages].reverse().find(m => m.role === 'user');
  if (!user) throw new Error('no user message');

  session.resetChatHistory();   // stateless per message, like the WASM path

  return await session.prompt(user.content, {
    temperature: temp,
    maxTokens: nPredict,
    signal,
    // node-llama-cpp streams text deltas; the bridge accumulates them into the
    // running total the renderer's onNewToken expects.
    onTextChunk: (delta) => { if (onToken && delta) onToken(delta); },
  });
}

module.exports = { load, generate };
