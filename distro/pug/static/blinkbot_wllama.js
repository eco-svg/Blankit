/* ═══════════════════════════════════════════════════════════════════════════
   blinkbot_wllama.js — BlinkBot on-device runtime (wllama + GGUF).

   The 0.5B v4 translator runs ENTIRELY in the browser via wllama (llama.cpp
   compiled to WASM). Raw user text never leaves the device; only the parsed
   JSON *actions* are POSTed to the server, which writes them to the DB.

   Freemium: first download starts a free window (server-tracked); after it,
   20 credits/month. The popup conveys this before the download begins.
   wllama caches the GGUF in browser storage, so it downloads only once.
   ═══════════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  // Must stay byte-identical to BLINKBOT_TRANSLATE_SYSTEM (bot_prompts.py) /
  // generate_v4.py NEW_SYSTEM — the model was fine-tuned on exactly this.
  const SYSTEM_PROMPT =
    "You are BlinkBot, a translator. Turn the user's message into ONE JSON command " +
    "object for the Veyra backend. You do not converse, explain, or chat. Output a " +
    "brief <think> reasoning line, then the JSON. The JSON has keys: \"actions\" " +
    "(a list of command objects), \"needs_groq\" (boolean, true ONLY when the user " +
    "asks for personality/class analysis), and \"reply\" (a short confirmation, a " +
    "few words when possible). Action types and their fields: " +
    "tick_habit{name}, log_note{text}, log_achievement{title}, " +
    "log_metric{skill,value}, suggest_skill{name}, add_habit{name}, " +
    "remove_habit{name}, delete_log{target}, edit_log{target,value}, undo{}, " +
    "open_profile{target}, logout{}. Never auto-add a skill (suggest only). " +
    "add_habit creates a new habit; remove_habit deletes one; delete_log removes a " +
    "past entry the user describes by target text; edit_log corrects a past entry's " +
    "value. Hedged or partial progress is logged as a note, then ask once whether it " +
    "counts.";

  const WLLAMA_VER  = '2.3.5';
  // jsdelivr is already CSP-whitelisted (script-src + connect-src); esm.sh is not.
  const WLLAMA_CDN  = `https://cdn.jsdelivr.net/npm/@wllama/wllama@${WLLAMA_VER}`;
  const WASM_PATHS  = {
    'single-thread/wllama.wasm': `${WLLAMA_CDN}/src/single-thread/wllama.wasm`,
    'multi-thread/wllama.wasm':  `${WLLAMA_CDN}/src/multi-thread/wllama.wasm`,
  };
  // Absolute URL (not root-relative): wllama fetches inside a blob: Worker, whose
  // base URL can't resolve "/pug/…". Must also end in .gguf (wllama validates).
  const MODEL_URL   = `${location.origin}/pug/api/blinkbot/model.gguf`;
  const MODEL_MB    = 380;
  // Multi-thread WASM needs SharedArrayBuffer, which needs the page to be
  // cross-origin isolated (COOP+COEP, set on /pug/home). When it is, use the
  // cores; otherwise wllama only has single-thread WASM and n_threads is moot.
  const N_THREADS   = self.crossOriginIsolated
    ? Math.max(2, Math.min(8, navigator.hardwareConcurrency || 4)) : 1;
  const LS_INSTALLED = 'blink_v4_installed';
  const LS_SPEAK     = 'blink_speak';            // '1' = read bot replies aloud

  // Voice (speech-to-text via Whisper, transformers.js). Library + ONNX runtime
  // load from jsdelivr (CSP-whitelisted); the model weights stream same-origin
  // from /pug/api/whisper/<repo>/… . Audio is transcribed ON-DEVICE — only the
  // resulting text is used; nothing is uploaded, same promise as the LLM.
  const TJS_VER     = '3.5.1';
  const TJS_CDN     = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TJS_VER}`;

  let wllama = null;     // engine, lazy
  let loading = false;   // model load in flight
  let generating = false; // one inference at a time (single-thread WASM serializes anyway)
  let status = { activated: false, expired: false };
  let transcriber = null;          // Whisper pipeline, lazy
  let sttCfg = null;               // chosen {id, device, dtype, multilingual, tier}
  let mediaRec = null, recChunks = [], recording = false;

  const $ = (id) => document.getElementById(id);
  const api = (url, body) => fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.json().then(j => ({ ok: r.ok, code: r.status, json: j })));

  // Inline SVGs (theme keeps emoji out of the UI).
  const _svg = (b) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${b}</svg>`;
  const ICON = {
    close:    _svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    mic:      _svg('<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>'),
    speakOn:  _svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>'),
    speakOff: _svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'),
  };

  // ── card state ────────────────────────────────────────────────────────────
  function renderCard() {
    const badge = $('blinkCardBadge'), btn = $('blinkCardBtn'), io = $('blinkCardIO');
    if (!badge || !btn) return;
    const installed = localStorage.getItem(LS_INSTALLED) === '1';
    // "Ready" = downloaded + still inside the free/credit window → show the inline
    // input instead of a button. (Engine loads on first use after a refresh.)
    const ready = installed && status.activated && !status.expired;
    if (status.expired) {
      badge.textContent = 'Renew';
      btn.textContent = `Renew · ${status.monthly_credits || 20} cr/mo`;
    } else if (ready) {
      badge.textContent = 'Ready';
    } else if (status.activated) {
      badge.textContent = 'Free';
      btn.textContent = 'Download';
    } else {
      badge.textContent = `Free · ${Math.round((status.free_days || 150) / 30)} mo`;
      btn.textContent = 'Download';
    }
    if (io)  io.classList.toggle('hidden', !ready);
    btn.classList.toggle('hidden', !!ready);
  }

  // Transient status shown in the card's subtitle line (no chat panel, no card
  // growth). `busy` = generating (keeps the pulsing cue, no auto-revert).
  let statusTimer = null;
  function setStatus(text, busy) {
    const sub = $('blinkCardSub');
    if (!sub) return;
    clearTimeout(statusTimer);
    sub.textContent = text;
    sub.classList.toggle('blink-streaming', !!busy);
    if (!busy) statusTimer = setTimeout(() => {
      sub.textContent = 'On-device AI Automator';
      sub.classList.remove('blink-streaming');
    }, 8000);
  }

  async function refreshStatus() {
    try { const r = await api('/pug/api/blinkbot/status'); if (r.ok) status = r.json; }
    catch (_) {}
    renderCard();
  }

  // ── popup (feature flex + freemium terms) ──────────────────────────────────
  function openPopup() {
    if ($('blinkPopup')) { $('blinkPopup').classList.remove('hidden'); return; }
    const months = Math.round((status.free_days || 150) / 30);
    const cr = status.monthly_credits || 20;
    const el = document.createElement('div');
    el.id = 'blinkPopup';
    el.className = 'custom-modal blink-modal';
    el.innerHTML = `
      <div class="modal-content blink-modal-content">
        <div class="blink-pop-head">
          <span class="blink-pop-name">BlinkBot</span>
          <span class="blink-pop-tag">On-device · private</span>
        </div>
        <p class="blink-pop-lead">Talk to your tracker in plain words. BlinkBot turns
          “ran 5k and add a cold-shower habit” into real logged actions — instantly,
          <b>100% on your device</b>. Your words never leave your phone.</p>
        <ul class="blink-pop-feats">
          <li>✓ Tick habits, log notes, metrics &amp; wins by just saying them</li>
          <li>✓ Create / remove habits, fix or delete past entries, undo</li>
          <li>✓ Runs offline after a one-time ~${MODEL_MB} MB download</li>
          <li>✓ Nothing you type is sent to a server — only the resulting action</li>
        </ul>
        <div class="blink-pop-terms">
          <b>Free for ${months} months.</b> After that, ${cr} credits/month to keep using it.
          Downloading now starts your free ${months}-month timer.
        </div>
        <div class="modal-actions blink-pop-actions">
          <button class="btn-secondary" id="blinkPopCancel" type="button">Not now</button>
          <button class="btn-primary" id="blinkPopGo" type="button">Download (~${MODEL_MB} MB)</button>
        </div>
        <div class="blink-pop-progress hidden" id="blinkPopProg">
          <div class="blink-pop-bar"><div id="blinkPopBarFill"></div></div>
          <span id="blinkPopProgTxt">Starting…</span>
        </div>
      </div>`;
    document.body.appendChild(el);
    $('blinkPopCancel').onclick = () => el.classList.add('hidden');
    $('blinkPopGo').onclick = startDownload;
    el.onclick = (e) => { if (e.target === el) el.classList.add('hidden'); };
  }

  // ── download + activate (starts the free timer) ────────────────────────────
  async function startDownload() {
    if (loading) return;
    // Already loaded? just close the popup — the inline card input is ready.
    if (localStorage.getItem(LS_INSTALLED) === '1' && wllama) { closePopup(); renderCard(); focusInput(); return; }

    loading = true;
    const go = $('blinkPopGo'), prog = $('blinkPopProg'), fill = $('blinkPopBarFill'), txt = $('blinkPopProgTxt');
    if (go) go.disabled = true;
    if (prog) prog.classList.remove('hidden');

    // 1) start the server-side free timer (idempotent)
    try { const a = await api('/pug/api/blinkbot/activate', {}); if (a.ok) status = a.json; }
    catch (_) {}

    // 2) load wllama + the GGUF (cached after first time)
    try {
      // jsdelivr's auto-ESM (/+esm) 404s for this package — use its real ESM entry.
      const { Wllama } = await import(`${WLLAMA_CDN}/esm/index.js`);
      wllama = new Wllama(WASM_PATHS);
      console.log('[blinkbot] crossOriginIsolated:', self.crossOriginIsolated, '| n_threads:', N_THREADS);
      await wllama.loadModelFromUrl(MODEL_URL, {
        n_ctx: 2048,
        n_threads: N_THREADS,
        progressCallback: ({ loaded, total }) => {
          const pct = total ? Math.round((loaded / total) * 100) : 0;
          if (fill) fill.style.width = pct + '%';
          if (txt)  txt.textContent = total ? `Downloading… ${pct}%` : 'Loading…';
        },
      });
      localStorage.setItem(LS_INSTALLED, '1');
      if (txt) txt.textContent = 'Ready.';
      loading = false;
      renderCard();        // swaps the Download button for the inline input row
      closePopup();
      focusInput();
    } catch (e) {
      loading = false;
      if (txt) txt.textContent = 'Download failed — tap to retry.';
      if (go)  go.disabled = false;
      console.error('[blinkbot] load failed', e);
      if (window.blinkLog) window.blinkLog('blinkbot:load', e);
    }
  }

  function closePopup() { const p = $('blinkPopup'); if (p) p.classList.add('hidden'); }

  function focusInput() { const i = $('blinkCardInput'); if (i) i.focus(); }

  // Pull the JSON out of "<think>…</think>\n{json}" — mirrors backend _blink_parse.
  function parseOut(raw) {
    const clean = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
    if (s === -1 || e === -1 || e < s) return null;
    try {
      const o = JSON.parse(clean.slice(s, e + 1));
      if (!Array.isArray(o.actions)) o.actions = [];
      return o;
    } catch (_) { return null; }
  }

  // Load the cached engine into memory (after a refresh wllama is null again).
  // First-time install goes through startDownload (popup + progress); this is the
  // lightweight "wake it back up from cache" path the inline input uses.
  async function ensureEngine() {
    if (wllama) return wllama;
    setStatus('Waking up…', true);
    const { Wllama } = await import(`${WLLAMA_CDN}/esm/index.js`);
    const w = new Wllama(WASM_PATHS);
    const t0 = performance.now();
    console.log('[blinkbot] crossOriginIsolated:', self.crossOriginIsolated, '| n_threads:', N_THREADS);
    await w.loadModelFromUrl(MODEL_URL, {
      n_ctx: 2048,
      n_threads: N_THREADS,
      // Show progress: a cache hit flies past; a re-download (cleared storage)
      // visibly climbs instead of sitting on a dead "Waking up…".
      progressCallback: ({ loaded, total }) => {
        const pct = total ? Math.round((loaded / total) * 100) : 0;
        setStatus(total ? `Loading model… ${pct}%` : 'Loading model…', true);
      },
    });
    console.log('[blinkbot] engine loaded in', Math.round(performance.now() - t0), 'ms');
    wllama = w;
    setStatus('Thinking…', true);
    return wllama;
  }

  // Queue so you can fire several messages without waiting for each — they log
  // one-by-one. (One message can also carry many activities; the model batches
  // those into multiple actions itself.)
  const inputQueue = [];
  function enqueue(msg) {
    msg = (msg || '').trim();
    if (!msg) return;
    inputQueue.push(msg);
    if (generating) setStatus(`Queued — ${inputQueue.length} waiting…`, true);
    pumpQueue();
  }
  function pumpQueue() {
    if (generating || !inputQueue.length) return;
    processInput(inputQueue.shift()).finally(pumpQueue);   // strictly serial
  }

  // Warm-up: if BlinkBot is installed & still active, load the engine and run ONE
  // throwaway generation in the background at page load — so the user's first REAL
  // message isn't the slow cold one. Output is discarded: no server call, no action.
  let warmedUp = false;
  function maybeWarmUp() {
    if (warmedUp || wllama || generating) return;
    if (localStorage.getItem(LS_INSTALLED) !== '1') return;
    if (!status.activated || status.expired) return;
    warmedUp = true;
    const go = () => warmUp();
    if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 5000 });
    else setTimeout(go, 2500);
  }
  async function warmUp() {
    if (wllama || generating) return;
    generating = true;
    try {
      await ensureEngine();
      await wllama.createChatCompletion(
        [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: 'hello' }],
        { nPredict: 1, sampling: { temp: 0 }, useCache: true });   // primes load + system-prompt KV
      console.log('[blinkbot] warmed up — first real reply will be fast');
      setStatus('Ready.', false);
    } catch (e) {
      console.warn('[blinkbot] warmup skipped', e);
    } finally {
      generating = false;
      pumpQueue();   // run anything the user queued during warm-up
    }
  }

  // The whole point: text/voice → parsed actions → server executes them. No chat.
  // Streams the model's output into the card subtitle so generation is visible.
  async function processInput(msg) {
    msg = (msg || '').trim();
    if (!msg || generating) return;
    generating = true;
    try { await ensureEngine(); }
    catch (e) {
      generating = false;
      setStatus('Couldn’t load BlinkBot — reopen the card.', false);
      console.error('[blinkbot] engine load failed', e);
      if (window.blinkLog) window.blinkLog('blinkbot:engine', e);
      return;
    }

    // Single-thread WASM must chew through the ~280-token system prompt before the
    // first output token, so stream it — the user sees it's alive (and how fast),
    // and a true hang surfaces as a timeout instead of an eternal "…".
    const ctrl = new AbortController();
    const t0 = performance.now();
    const timer = setTimeout(() => ctrl.abort(), 120000);   // 120s hard cap

    let parsed, raw;
    try {
      raw = await wllama.createChatCompletion(
        [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: msg }],
        {
          nPredict: 200,
          sampling: { temp: 0.1 },
          useCache: true,            // reuse the cached system-prompt KV → skip re-eval on msg 2+
          abortSignal: ctrl.signal,
          onNewToken: (_t, _p, currentText) =>
            setStatus(currentText.replace(/<think>/g, '').trim() || '…', true),
        });
      raw = typeof raw === 'string' ? raw : (raw?.content || '');
      console.log('[blinkbot] gen done in', Math.round(performance.now() - t0), 'ms; chars:', raw.length);
      console.log('[blinkbot] RAW OUTPUT:\n' + raw);          // what the model actually emitted
      parsed = parseOut(raw);
      console.log('[blinkbot] PARSED:', parsed, '| actions:', parsed && parsed.actions);
    } catch (e) {
      setStatus(ctrl.signal.aborted ? 'Timed out — too slow on this device.' : 'BlinkBot error.', false);
      console.error('[blinkbot] gen failed', e);
      if (window.blinkLog) window.blinkLog('blinkbot:gen', e);
      return;
    } finally {
      clearTimeout(timer);
      generating = false;
    }
    if (!parsed) { setStatus("Couldn’t read that as a command.", false); return; }

    // Send the parsed result to the server to execute (raw text stays local).
    const r = await api('/pug/api/blinkbot', {
      message: parsed.needs_groq ? msg : undefined,
      actions: parsed.actions, needs_groq: parsed.needs_groq, reply: parsed.reply,
    });
    console.log('[blinkbot] SERVER:', r.code, r.json);        // performed[] shows what the DB did
    if (r.code === 402 && r.json.paywall) {
      setStatus(r.json.reply || 'Free period ended.', false);
      offerRenew();
      return;
    }
    const reply = r.json.reply || 'Done.';
    setStatus(reply, false);
    speak(reply);
    fireApplied(r.json.performed);
    if (Array.isArray(r.json.pending_confirm) && r.json.pending_confirm.length) {
      r.json.pending_confirm.forEach(p => offerConfirm(p));
    }
    handleNav(r.json.nav);
  }

  // BlinkBot mutates the DB server-side; the home widgets only load on page load,
  // so tell them to re-fetch — otherwise a ticked habit / logged note stays
  // invisible until a manual reload. habits.js / notes.js / achievements.js listen.
  function fireApplied(performed) {
    if (!Array.isArray(performed) || !performed.length) return;
    document.dispatchEvent(new CustomEvent('blinkbot:applied'));
    window.dispatchEvent(new Event('habitUpdated'));   // refresh the consistency chart too
  }

  // Inline Yes/No in the card subtitle (textContent only — never inject user text).
  function offerConfirm(pending) {
    const sub = $('blinkCardSub');
    if (!sub) return;
    clearTimeout(statusTimer);
    sub.classList.remove('blink-streaming');
    sub.textContent = pending.summary + ' ';
    const yes = document.createElement('button'); yes.textContent = 'Yes'; yes.className = 'r-blink-confirm-btn';
    const no  = document.createElement('button'); no.textContent  = 'No';  no.className  = 'r-blink-confirm-btn';
    yes.onclick = async () => {
      const r = await api('/pug/api/blinkbot', { confirm_action: pending.action });
      setStatus((r.json && r.json.reply) || 'Done.', false);
      fireApplied(r.json && r.json.performed);
    };
    no.onclick = () => setStatus('Cancelled.', false);
    sub.appendChild(yes); sub.appendChild(document.createTextNode(' ')); sub.appendChild(no);
  }

  async function offerRenew() {
    const r = await api('/pug/api/blinkbot/pay', {});
    if (r.ok) { status = r.json; renderCard(); setStatus('Renewed — 30 more days.', false); }
    else if (r.json.error === 'insufficient_credits')
      setStatus(`Need ${r.json.need} credits (you have ${r.json.have}). Top up in your wallet.`, false);
  }

  function handleNav(nav) {
    if (!nav) return;
    if (nav.action === 'logout') window.location.href = '/logout';
    // open_profile etc. left to the host app's router; emit an event it can hook.
    document.dispatchEvent(new CustomEvent('blinkbot:nav', { detail: nav }));
  }

  // ── text-to-speech (read replies aloud) ────────────────────────────────────
  // speechSynthesis runs on-device in every browser; the native wrapper can
  // inject window.BlinkNativeTTS for nicer OS voices.
  // TTS is opt-in (LS_SPEAK); off by default — an automator shouldn't talk back
  // unless asked. (Toggle UI lived in the old chat panel; re-add later if wanted.)
  function speakEnabled() { return localStorage.getItem(LS_SPEAK) === '1'; }

  function speak(text) {
    if (!speakEnabled() || !text) return;
    if (window.BlinkNativeTTS && window.BlinkNativeTTS.speak) { window.BlinkNativeTTS.speak(text); return; }
    if (!('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = 1.05;
      speechSynthesis.speak(u);
    } catch (_) {}
  }

  // ── speech-to-text (Whisper, on-device) ─────────────────────────────────────
  // Resource tier: native app gets the bigger base.en model (and can plug in a
  // native recognizer); browsers use tiny.en on WebGPU when present, else WASM.
  async function pickSttCfg() {
    if (sttCfg) return sttCfg;
    const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    let webgpu = false;
    if ('gpu' in navigator) { try { webgpu = !!(await navigator.gpu.requestAdapter()); } catch (_) {} }
    if (native) {
      sttCfg = { id: 'onnx-community/whisper-base.en', device: webgpu ? 'webgpu' : 'wasm',
                 dtype: webgpu ? 'fp16' : 'quantized', tier: 'native' };
    } else if (webgpu) {
      sttCfg = { id: 'onnx-community/whisper-tiny.en', device: 'webgpu', dtype: 'fp16', tier: 'webgpu' };
    } else {
      sttCfg = { id: 'onnx-community/whisper-tiny.en', device: 'wasm', dtype: 'quantized', tier: 'wasm' };
    }
    sttCfg.multilingual = !sttCfg.id.endsWith('.en');
    return sttCfg;
  }

  async function loadTranscriber(onProgress) {
    if (transcriber) return transcriber;
    const cfg = await pickSttCfg();
    const { pipeline, env } = await import(/* @vite-ignore */ `${TJS_CDN}/dist/transformers.min.js`);
    env.allowRemoteModels = false;                 // never reach out to HF directly
    env.allowLocalModels  = true;
    env.localModelPath    = '/pug/api/whisper/';   // same-origin → streams from our bucket
    env.backends.onnx.wasm.wasmPaths = `${TJS_CDN}/dist/`;
    transcriber = await pipeline('automatic-speech-recognition', cfg.id, {
      device: cfg.device, dtype: cfg.dtype, progress_callback: onProgress,
    });
    return transcriber;
  }

  function micBusy(on)  { const b = $('blinkCardMic'); if (b) b.classList.toggle('busy', on); }
  function micActive(on){ const b = $('blinkCardMic'); if (b) b.classList.toggle('rec', on); }

  async function toggleMic() {
    // Native recognizer (wrapped app) takes priority — fastest, OS-private.
    if (window.BlinkNativeSTT && window.BlinkNativeSTT.listen) {
      micActive(true);
      try { const text = await window.BlinkNativeSTT.listen(); appendTranscript(text); }
      catch (e) { console.error('[blinkbot stt native]', e); }
      finally { micActive(false); }
      return;
    }
    if (recording) { stopRec(); return; }
    await startRec();
  }

  async function startRec() {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { setStatus('Mic blocked — allow access, or just type.', false); return; }
    recChunks = []; recording = true; micActive(true);
    mediaRec = new MediaRecorder(stream);
    mediaRec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    mediaRec.onstop = () => { stream.getTracks().forEach(t => t.stop()); transcribe(); };
    mediaRec.start();
  }

  function stopRec() {
    if (!recording) return;
    recording = false; micActive(false);
    try { if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop(); } catch (_) {}
  }

  async function transcribe() {
    if (!recChunks.length) return;
    micBusy(true);
    try {
      const blob  = new Blob(recChunks, { type: recChunks[0].type || 'audio/webm' });
      const audio = await blobToMono16k(blob);
      const t     = await loadTranscriber(() => {});
      const out   = await t(audio, sttCfg.multilingual ? { language: 'en', task: 'transcribe' } : {});
      appendTranscript((out && out.text || '').trim());
    } catch (e) {
      console.error('[blinkbot stt]', e);
      if (window.blinkLog) window.blinkLog('blinkbot:stt', e);
      setStatus('Couldn’t transcribe that — try again or type it.', false);
    } finally {
      micBusy(false); recChunks = [];
    }
  }

  // Decode whatever the recorder produced to mono 16 kHz Float32 (Whisper's input).
  async function blobToMono16k(blob) {
    const buf = await blob.arrayBuffer();
    const ac  = new (window.AudioContext || window.webkitAudioContext)();
    const dec = await ac.decodeAudioData(buf);
    ac.close();
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(dec.duration * 16000)), 16000);
    const src = off.createBufferSource();
    src.buffer = dec; src.connect(off.destination); src.start();
    const rendered = await off.startRendering();
    return rendered.getChannelData(0);
  }

  // Voice is the "primary" path: transcribe → show it in the box → run it.
  function appendTranscript(text) {
    if (!text) return;
    const inp = $('blinkCardInput');
    if (inp) { inp.value = text; inp.focus(); }
    enqueue(text);
  }

  // ── styles (self-contained; uses theme vars with fallbacks) ─────────────────
  function injectStyles() {
    if ($('blinkWllamaStyles')) return;
    const s = document.createElement('style');
    s.id = 'blinkWllamaStyles';
    s.textContent = `
      .r-blinkbot-dl-btn{margin-top:8px;width:100%;padding:6px 10px;border-radius:8px;
        border:1px solid var(--border2,#333);background:var(--accent,#6c8cff);color:#fff;
        font-size:12px;font-weight:600;cursor:pointer;transition:opacity .15s}
      .r-blinkbot-dl-btn:hover{opacity:.88}
      .blink-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;
        justify-content:center;background:rgba(0,0,0,.6)}
      .blink-modal.hidden{display:none}
      .blink-modal-content{max-width:420px;width:92%;background:var(--surface-1,#15161a);
        color:var(--text,#e6e6e6);border:1px solid var(--border2,#2a2c33);border-radius:14px;
        padding:20px 22px;box-shadow:0 18px 60px rgba(0,0,0,.5)}
      .blink-pop-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
      .blink-pop-name{font-size:19px;font-weight:700}
      .blink-pop-tag{font-size:11px;padding:2px 8px;border-radius:20px;
        background:var(--surface-2,#23252c);color:var(--text-dim,#9aa0aa)}
      .blink-pop-lead{font-size:13px;line-height:1.5;color:var(--text,#cfd2d8);margin:0 0 12px}
      .blink-pop-feats{list-style:none;padding:0;margin:0 0 14px;font-size:12.5px;line-height:1.85;color:var(--text-dim,#b7bcc5)}
      .blink-pop-terms{font-size:12.5px;line-height:1.5;padding:10px 12px;border-radius:9px;
        background:var(--surface-2,#1d1f25);border:1px solid var(--border2,#2a2c33);margin-bottom:16px}
      .blink-pop-actions{display:flex;gap:10px;justify-content:flex-end}
      .blink-pop-actions button{padding:8px 16px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid var(--border2,#2a2c33)}
      .blink-pop-actions .btn-secondary{background:transparent;color:var(--text-dim,#9aa0aa)}
      .blink-pop-actions .btn-primary{background:var(--accent,#6c8cff);color:#fff;border-color:transparent}
      .blink-pop-progress{margin-top:14px;font-size:12px;color:var(--text-dim,#9aa0aa)}
      .blink-pop-progress.hidden{display:none}
      .blink-pop-bar{height:6px;border-radius:6px;background:var(--surface-2,#23252c);overflow:hidden;margin-bottom:6px}
      .blink-pop-bar>div{height:100%;width:0;background:var(--accent,#6c8cff);transition:width .2s}
      /* Inline automator input on the card (mic + text + send) — no chat panel. */
      .r-blinkbot-io{display:flex;gap:6px;align-items:center;margin-top:8px}
      .r-blinkbot-io.hidden{display:none}
      .r-blinkbot-io input{flex:1;min-width:0;padding:7px 10px;border-radius:8px;
        border:1px solid var(--border2,#2a2c33);background:var(--surface-2,#1d1f25);
        color:var(--text,#e6e6e6);font-size:12px}
      .r-blinkbot-io input::placeholder{color:var(--text-dim,#7d828c)}
      .r-blinkbot-mic,.r-blinkbot-send{display:flex;align-items:center;justify-content:center;flex:0 0 auto;
        height:32px;border-radius:8px;border:1px solid var(--border2,#2a2c33);cursor:pointer;line-height:0;
        transition:color .15s,background .15s,box-shadow .15s,opacity .15s}
      .r-blinkbot-mic{width:32px;padding:0;background:var(--surface-2,#1d1f25);color:var(--text-dim,#9aa0aa)}
      .r-blinkbot-mic:hover{color:var(--text,#e6e6e6)}
      .r-blinkbot-mic.rec{color:#fff;background:#d8483f;border-color:#d8483f;animation:blinkMicPulse 1.1s ease-in-out infinite}
      .r-blinkbot-mic.busy{color:var(--accent,#6c8cff);pointer-events:none}
      .r-blinkbot-mic.busy svg{animation:blinkSpin .8s linear infinite}
      .r-blinkbot-send{width:34px;font-size:15px;font-weight:700;background:var(--accent,#6c8cff);color:#fff;border-color:transparent}
      .r-blinkbot-send:hover{opacity:.88}
      .r-blink-confirm-btn{margin-left:6px;padding:2px 9px;border-radius:6px;border:none;cursor:pointer;font-size:11px}
      .r-blink-confirm-btn:first-of-type{background:var(--accent,#6c8cff);color:#fff}
      .r-blink-confirm-btn:last-of-type{background:var(--surface-2,#23252c);color:var(--text-dim,#9aa0aa)}
      .blink-streaming{opacity:.7;animation:blinkPulse 1.1s ease-in-out infinite}
      @keyframes blinkPulse{0%,100%{opacity:.5}50%{opacity:.85}}
      @keyframes blinkMicPulse{0%,100%{box-shadow:0 0 0 0 rgba(216,72,63,.5)}50%{box-shadow:0 0 0 6px rgba(216,72,63,0)}}
      @keyframes blinkSpin{to{transform:rotate(360deg)}}`;
    document.head.appendChild(s);
  }

  // ── wire up ────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const card = $('rGroqCard'), btn = $('blinkCardBtn');
    if (!card) return;
    injectStyles();
    refreshStatus().then(maybeWarmUp);   // auto-load + prime in the background once status is known

    const input = $('blinkCardInput'), send = $('blinkCardSend'), mic = $('blinkCardMic');
    if (mic) mic.innerHTML = ICON.mic;

    const run = () => { const v = input ? input.value : ''; if (input) input.value = ''; enqueue(v); };
    if (send)  send.addEventListener('click', (e) => { e.stopPropagation(); run(); });
    if (input) {
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    }
    if (mic) {
      mic.addEventListener('click', (e) => { e.stopPropagation(); toggleMic(); });
      // Mic needs getUserMedia + a secure context (https/localhost). Hide it otherwise.
      const micOk = window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
      if (!micOk && !(window.BlinkNativeSTT && window.BlinkNativeSTT.listen)) mic.style.display = 'none';
    }

    // Download button (pre-install) opens the terms popup. Clicking the card body
    // before install does the same; after install it just focuses the input.
    const onDownload = (e) => { e.stopPropagation(); openPopup(); };
    if (btn) btn.addEventListener('click', onDownload);
    card.addEventListener('click', () => {
      const io = $('blinkCardIO');
      if (io && !io.classList.contains('hidden')) focusInput(); else openPopup();
    });
  });
})();
