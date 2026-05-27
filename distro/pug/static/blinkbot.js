/* ═══════════════════════════════════════
   blinkbot.js — WebLLM-powered AI assistant
   Local: Qwen2.5-1.5B via WebGPU (Chrome/Edge/Brave, Android 12+, iOS 18+)
   Fallback: Groq server
═══════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {

  /* ── DOM ──────────────────────────────────────────────────────── */
  const downloadState = document.getElementById('blinkDownloadState');
  const chatState     = document.getElementById('blinkChatState');
  const chatWindow    = document.getElementById('blinkChatWindow');
  const input         = document.getElementById('blinkInput');
  const sendBtn       = document.getElementById('sendBlinkBtn');
  const modeLabel     = document.getElementById('blinkModeLabel');

  /* ── Constants ────────────────────────────────────────────────── */
  const MODEL_ID      = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
  const MODEL_LIB     = 'Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm';
  const MODEL_MB      = 860;
  const WEBLLM_CDN    = '/pug_style/webllm.js';
  const STORE_KEY     = 'blinkbot-v2';
  const _origin       = window.location.origin;
  const _MLC_APP_CFG  = {
    model_list: [{
      model:               `${_origin}/pug/mlc-weights`,
      model_id:            MODEL_ID,
      model_lib:           `${_origin}/pug/mlc-lib/${MODEL_LIB}`,
      low_resource_required: true,
      overrides:           { context_window_size: 4096 },
    }],
  };

  /* ── State ────────────────────────────────────────────────────── */
  let engine       = null;
  let systemPrompt = '';
  let history      = [];

  /* ── localStorage ─────────────────────────────────────────────── */
  const store = {
    get: ()  => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } },
    set: (d) => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...store.get(), ...d })); } catch {} },
    clear: () => { try { localStorage.removeItem(STORE_KEY); } catch {} },
  };

  /* ── Helpers ──────────────────────────────────────────────────── */
  function setMode(text) { if (modeLabel) modeLabel.textContent = text; }

  function setProgress(pct, msg) {
    const bar = document.getElementById('blinkProgressBar');
    const lbl = document.getElementById('blinkProgressMsg');
    if (bar) { bar.style.width = Math.round(pct * 100) + '%'; bar.style.animation = ''; }
    if (lbl && msg !== undefined) lbl.textContent = msg;
  }

  async function fetchContext() {
    try {
      const r = await fetch('/pug/api/blinkbot-context');
      return r.ok ? r.json() : null;
    } catch { return null; }
  }

  async function hasWebGPU() {
    if (!('gpu' in navigator)) return false;
    try { return !!(await navigator.gpu.requestAdapter()); } catch { return false; }
  }

  /* ── UI templates ─────────────────────────────────────────────── */
  const S = {
    wordmark: `<div style="font-size:1.15rem;font-family:var(--font-mono);font-weight:700;letter-spacing:0.1em;color:#4a7aaa;margin-bottom:2px;">BLINK<span style="color:var(--text);">BOT</span></div>`,

    serverOnly() {
      return `<div style="display:flex;flex-direction:column;gap:12px;">
        ${S.wordmark}
        <p style="font-size:0.78rem;color:var(--text);line-height:1.65;margin:0;">
          Running on <strong>Groq</strong> — fast, free, always on.
        </p>
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px 12px;">
          <div style="font-size:0.58rem;font-family:var(--font-mono);color:var(--text-dim);letter-spacing:0.1em;margin-bottom:5px;">LOCAL MODEL UNAVAILABLE</div>
          <p style="font-size:0.72rem;color:var(--text-dim);margin:0;line-height:1.55;">
            WebGPU is required for on-device AI — your browser doesn't support it yet.
            Try Chrome or Edge on a recent device for private, offline inference.
          </p>
        </div>
        <button id="blinkStartBtn" style="margin-top:4px;font-size:0.78rem;padding:10px 0;cursor:pointer;border-radius:8px;background:#4a7aaa;color:#fff;border:none;font-family:var(--font-mono);font-weight:600;letter-spacing:0.06em;width:100%;">Open BlinkBot →</button>
      </div>`;
    },

    intro(pct) {
      const hasPct = pct > 0;
      const pctInt = Math.round(pct * 100);
      const mbLeft = Math.round((1 - pct) * MODEL_MB);
      return `<div style="display:flex;flex-direction:column;gap:12px;">
        ${S.wordmark}
        ${hasPct ? `
        <div style="background:rgba(74,122,170,0.1);border:1px solid rgba(74,122,170,0.28);border-radius:8px;padding:10px 12px;">
          <div style="font-size:0.58rem;font-family:var(--font-mono);color:#7aafdd;letter-spacing:0.1em;margin-bottom:6px;">DOWNLOAD IN PROGRESS — ${pctInt}%</div>
          <div style="background:rgba(255,255,255,0.08);border-radius:4px;height:4px;overflow:hidden;margin-bottom:5px;">
            <div style="height:100%;width:${pctInt}%;background:#4a7aaa;"></div>
          </div>
          <p style="font-size:0.68rem;color:var(--text-dim);margin:0;">~${mbLeft} MB remaining — resumes where it left off.</p>
        </div>` : ''}
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:5px;">
          <div style="font-size:0.58rem;font-family:var(--font-mono);color:var(--text-dim);letter-spacing:0.1em;margin-bottom:3px;">WHY RUN IT LOCALLY?</div>
          ${['Instant — no network round-trip','100% private — nothing leaves your device','Works offline','No rate limits, no server costs'].map(p =>
            `<div style="font-size:0.73rem;color:var(--text);line-height:1.5;padding-left:14px;position:relative;"><span style="position:absolute;left:2px;color:#4a7aaa;">·</span>${p}</div>`
          ).join('')}
          <div style="font-size:0.64rem;color:var(--text-dim);margin-top:4px;opacity:0.6;">~${MODEL_MB} MB · WiFi recommended · permanent cache after first download</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:7px;">
          <button id="blinkDownloadBtn" style="font-size:0.78rem;padding:10px 0;cursor:pointer;border-radius:8px;background:#4a7aaa;color:#fff;border:none;font-family:var(--font-mono);font-weight:600;letter-spacing:0.06em;width:100%;">${hasPct ? '↻ Resume download' : `⬇ Download local model (~${MODEL_MB} MB)`}</button>
          <button id="blinkServerBtn" style="font-size:0.73rem;padding:8px 0;cursor:pointer;border-radius:8px;background:rgba(255,255,255,0.05);color:var(--text-dim);border:1px solid rgba(255,255,255,0.09);font-family:var(--font-mono);letter-spacing:0.04em;width:100%;">Use server for now</button>
        </div>
      </div>`;
    },

    downloading(pct) {
      const mbDone = Math.round(pct * MODEL_MB);
      return `<div style="display:flex;flex-direction:column;gap:13px;">
        ${S.wordmark}
        <p style="font-size:0.78rem;color:var(--text);line-height:1.65;margin:0;">Downloading — saved permanently after this.</p>
        <div>
          <div style="background:rgba(255,255,255,0.07);border-radius:6px;height:6px;overflow:hidden;margin-bottom:8px;">
            <div id="blinkProgressBar" style="height:100%;width:${Math.round(pct*100)}%;background:#4a7aaa;transition:width 0.4s ease;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <div id="blinkProgressMsg" style="font-family:var(--font-mono);font-size:0.67rem;color:var(--text-dim);">${mbDone} / ${MODEL_MB} MB</div>
            <div id="blinkProgressPct" style="font-family:var(--font-mono);font-size:0.67rem;color:var(--text-dim);">${Math.round(pct*100)}%</div>
          </div>
        </div>
        <p style="font-size:0.68rem;color:var(--text-dim);margin:0;opacity:0.6;">Close the tab anytime — resumes next session from where it stopped.</p>
        <button id="blinkUseServerNow" style="font-size:0.73rem;padding:8px 0;cursor:pointer;border-radius:8px;background:rgba(255,255,255,0.05);color:var(--text-dim);border:1px solid rgba(255,255,255,0.09);font-family:var(--font-mono);letter-spacing:0.04em;width:100%;">Chat via server while downloading →</button>
      </div>`;
    },

    loading() {
      return `<div style="display:flex;flex-direction:column;gap:13px;">
        ${S.wordmark}
        <p style="font-size:0.78rem;color:var(--text);line-height:1.65;margin:0;">Loading model from cache...</p>
        <div style="background:rgba(255,255,255,0.07);border-radius:6px;height:6px;overflow:hidden;">
          <div id="blinkProgressBar" style="height:100%;width:0%;background:#4a7aaa;animation:blinkPulse 1.4s ease-in-out infinite;"></div>
        </div>
        <div id="blinkProgressMsg" style="font-family:var(--font-mono);font-size:0.67rem;color:var(--text-dim);">Please wait...</div>
      </div>`;
    },

    loadError(msg, pct) {
      return `<div style="display:flex;flex-direction:column;gap:12px;">
        ${S.wordmark}
        <div style="background:rgba(255,80,80,0.08);border:1px solid rgba(255,80,80,0.25);border-radius:8px;padding:10px 12px;">
          <div style="font-size:0.58rem;font-family:var(--font-mono);color:#ff7070;letter-spacing:0.1em;margin-bottom:5px;">LOCAL MODEL ERROR</div>
          <p style="font-size:0.71rem;color:var(--text-dim);margin:0;line-height:1.55;word-break:break-word;">${msg}</p>
        </div>
        <p style="font-size:0.7rem;color:var(--text-dim);margin:0;opacity:0.7;">Open DevTools → Console for details. ${pct > 0 ? `Download was ${Math.round(pct*100)}% complete.` : ''}</p>
        <div style="display:flex;flex-direction:column;gap:7px;">
          <button id="blinkRetryBtn" style="font-size:0.73rem;padding:9px 0;cursor:pointer;border-radius:8px;background:rgba(255,255,255,0.07);color:var(--text);border:1px solid rgba(255,255,255,0.12);font-family:var(--font-mono);letter-spacing:0.04em;width:100%;">↻ Try again</button>
          <button id="blinkErrorServerBtn" style="font-size:0.73rem;padding:8px 0;cursor:pointer;border-radius:8px;background:#4a7aaa;color:#fff;border:none;font-family:var(--font-mono);font-weight:600;letter-spacing:0.04em;width:100%;">Use server instead →</button>
        </div>
      </div>`;
    },
  };

  /* ── Engine load (WebLLM) ─────────────────────────────────────── */
  async function loadEngine(isDownload) {
    const { MLCEngine } = await import(WEBLLM_CDN);
    if (!MLCEngine) throw new Error('WebLLM bundle loaded but MLCEngine not found');
    const e = new MLCEngine({
      appConfig:            _MLC_APP_CFG,
      initProgressCallback: (report) => onProgress(report.progress, isDownload),
    });
    await e.reload(MODEL_ID);
    engine = e;
    store.set({ complete: true, pct: 1 });
  }

  function onProgress(pct, isDownload) {
    const mbDone = Math.round(pct * MODEL_MB);
    store.set({ pct });
    if (isDownload) {
      const bar  = document.getElementById('blinkProgressBar');
      const msg  = document.getElementById('blinkProgressMsg');
      const pct2 = document.getElementById('blinkProgressPct');
      if (bar)  { bar.style.width = Math.round(pct * 100) + '%'; bar.style.animation = ''; }
      if (msg)  msg.textContent  = `${mbDone} / ${MODEL_MB} MB`;
      if (pct2) pct2.textContent = Math.round(pct * 100) + '%';
    } else {
      setProgress(pct, pct < 1 ? `${Math.round(pct * 100)}%...` : 'Ready.');
    }
  }

  /* ── Chat activation ──────────────────────────────────────────── */
  function activateChat(isLocal) {
    downloadState.style.display   = 'none';
    chatState.style.display       = 'flex';
    chatState.style.flexDirection = 'column';
    chatState.style.flex          = '1';
    chatState.style.minHeight     = '0';
    setMode(isLocal ? 'local · Qwen2.5-1.5B' : 'server · Groq');
    if (!chatWindow.querySelector('.chat-message')) {
      addMsg('Online. What do you need?', 'ai', null);
    }
    input.focus();
  }

  /* ── Chat UI helpers ──────────────────────────────────────────── */
  function addMsg(text, role, source) {
    const div     = document.createElement('div');
    div.className = `chat-message msg-${role}`;
    const body    = (role === 'ai' && typeof marked !== 'undefined') ? marked.parse(text) : (role === 'ai' ? text : '');
    if (role === 'user') {
      div.textContent = text;
    } else {
      div.innerHTML = body;
      if (source) div.innerHTML += `<span style="font-size:0.58rem;opacity:0.25;display:block;margin-top:5px;font-family:var(--font-mono);">[${source}]</span>`;
    }
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return div;
  }

  function showTyping() {
    const el = document.createElement('div');
    el.className = 'chat-message msg-ai';
    el.id        = 'blinkTyping';
    el.innerHTML = '<span style="opacity:0.4;font-style:italic;font-size:0.8rem;">...</span>';
    chatWindow.appendChild(el);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
  function removeTyping() { document.getElementById('blinkTyping')?.remove(); }

  /* ── Send ─────────────────────────────────────────────────────── */
  async function send() {
    const msg = input.value.trim();
    if (!msg) return;
    input.value    = '';
    input.disabled = true;
    sendBtn.disabled = true;
    addMsg(msg, 'user', null);

    try {
      let reply, source;

      if (engine) {
        /* local inference — streaming */
        const messages = [{ role: 'system', content: systemPrompt }];
        history.slice(-10).forEach(h => messages.push(h));
        messages.push({ role: 'user', content: msg });

        const bubble  = addMsg('', 'ai', null);
        bubble.id     = 'blinkStreaming';
        const stream  = await engine.chat.completions.create({
          messages, stream: true, temperature: 0.7, max_tokens: 512,
        });

        let full = '';
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content || '';
          full += delta;
          bubble.innerHTML = typeof marked !== 'undefined' ? marked.parse(full) : full;
          chatWindow.scrollTop = chatWindow.scrollHeight;
        }
        bubble.innerHTML += `<span style="font-size:0.58rem;opacity:0.25;display:block;margin-top:5px;font-family:var(--font-mono);">[local]</span>`;
        reply  = full;
        source = 'local';

      } else {
        /* server fallback — Groq */
        showTyping();
        const r    = await fetch('/pug/api/blinkbot', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ message: msg, history: history.slice(-12) }),
        });
        const data = await r.json();
        removeTyping();
        reply  = data.answer || 'No response — try again.';
        source = 'groq';
        addMsg(reply, 'ai', source);
      }

      if (reply) {
        history.push({ role: 'user',      content: msg   });
        history.push({ role: 'assistant', content: reply });
        if (history.length > 20) history = history.slice(-20);
      }

    } catch (err) {
      removeTyping();
      document.getElementById('blinkStreaming')?.remove();
      if (err.name !== 'AbortError') {
        addMsg('Something went wrong — try again.', 'ai', null);
        console.error('[blinkbot]', err);
      }
    } finally {
      input.disabled   = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  /* ── Boot sequence ────────────────────────────────────────────── */
  setMode('...');

  const ctx = await fetchContext();
  if (!ctx) {
    downloadState.innerHTML = '<p style="padding:20px 0;color:var(--text-dim);font-size:0.75rem;font-family:var(--font-mono);">Could not connect. Refresh to retry.</p>';
    return;
  }
  systemPrompt = ctx.system_prompt || '';

  const gpuOk  = await hasWebGPU();
  const stored = store.get();

  /* Case 1: no WebGPU — server only */
  if (!gpuOk) {
    downloadState.innerHTML = S.serverOnly();
    setMode('server · Groq');
    document.getElementById('blinkStartBtn')?.addEventListener('click', () => activateChat(false));
    return;
  }

  /* Case 2: model already fully cached — load and go */
  if (stored.complete) {
    downloadState.innerHTML = S.loading();
    try {
      await loadEngine(false);
      activateChat(true);
    } catch (e) {
      console.error('[blinkbot] cache load failed:', e);
      store.clear();
      downloadState.innerHTML = S.loadError(e?.message || String(e), 0);
      document.getElementById('blinkRetryBtn')?.addEventListener('click', () => {
        downloadState.innerHTML = S.intro(0);
        wireIntro(0);
      });
      document.getElementById('blinkErrorServerBtn')?.addEventListener('click', () => activateChat(false));
    }
    return;
  }

  /* Case 3: fresh or partial — show intro */
  const pct = stored.pct || 0;
  downloadState.innerHTML = S.intro(pct);
  wireIntro(pct);

  /* ── Intro button wiring ──────────────────────────────────────── */
  function wireIntro(existingPct) {
    document.getElementById('blinkDownloadBtn')?.addEventListener('click', async () => {
      downloadState.innerHTML = S.downloading(existingPct);

      document.getElementById('blinkUseServerNow')?.addEventListener('click', () => {
        activateChat(false);
      });

      try {
        await loadEngine(true);
        activateChat(true);
      } catch (e) {
        console.error('[blinkbot] loadEngine failed:', e);
        const newPct = store.get().pct || existingPct;
        downloadState.innerHTML = S.loadError(e?.message || String(e), newPct);
        document.getElementById('blinkRetryBtn')?.addEventListener('click', () => {
          downloadState.innerHTML = S.intro(newPct);
          wireIntro(newPct);
        });
        document.getElementById('blinkErrorServerBtn')?.addEventListener('click', () => activateChat(false));
      }
    });

    document.getElementById('blinkServerBtn')?.addEventListener('click', () => activateChat(false));
  }

});
