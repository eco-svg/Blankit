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
  const MODEL_URL   = '/pug/api/blinkbot/model';
  const MODEL_MB    = 380;
  const LS_INSTALLED = 'blink_v4_installed';

  let wllama = null;     // engine, lazy
  let loading = false;   // model load in flight
  let status = { activated: false, expired: false };

  const $ = (id) => document.getElementById(id);
  const api = (url, body) => fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.json().then(j => ({ ok: r.ok, code: r.status, json: j })));

  // ── card state ────────────────────────────────────────────────────────────
  function renderCard() {
    const badge = $('blinkCardBadge'), btn = $('blinkCardBtn');
    if (!badge || !btn) return;
    const installed = localStorage.getItem(LS_INSTALLED) === '1';
    if (status.expired) {
      badge.textContent = 'Renew';
      btn.textContent = `Renew · ${status.monthly_credits || 20} cr/mo`;
    } else if (installed && status.activated) {
      badge.textContent = 'Ready';
      btn.textContent = 'Open';
    } else if (status.activated) {
      badge.textContent = 'Free';
      btn.textContent = 'Download';
    } else {
      badge.textContent = `Free · ${Math.round((status.free_days || 150) / 30)} mo`;
      btn.textContent = 'Download';
    }
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
    // Already have it cached? skip straight to chat.
    if (localStorage.getItem(LS_INSTALLED) === '1' && wllama) { closePopup(); openChat(); return; }

    loading = true;
    const go = $('blinkPopGo'), prog = $('blinkPopProg'), fill = $('blinkPopBarFill'), txt = $('blinkPopProgTxt');
    if (go) go.disabled = true;
    if (prog) prog.classList.remove('hidden');

    // 1) start the server-side free timer (idempotent)
    try { const a = await api('/pug/api/blinkbot/activate', {}); if (a.ok) status = a.json; }
    catch (_) {}

    // 2) load wllama + the GGUF (cached after first time)
    try {
      const { Wllama } = await import(`${WLLAMA_CDN}/+esm`);
      wllama = new Wllama(WASM_PATHS);
      await wllama.loadModelFromUrl(MODEL_URL, {
        n_ctx: 2048,
        progressCallback: ({ loaded, total }) => {
          const pct = total ? Math.round((loaded / total) * 100) : 0;
          if (fill) fill.style.width = pct + '%';
          if (txt)  txt.textContent = total ? `Downloading… ${pct}%` : 'Loading…';
        },
      });
      localStorage.setItem(LS_INSTALLED, '1');
      if (txt) txt.textContent = 'Ready.';
      loading = false;
      renderCard();
      closePopup();
      openChat();
    } catch (e) {
      loading = false;
      if (txt) txt.textContent = 'Download failed — tap to retry.';
      if (go)  go.disabled = false;
      console.error('[blinkbot] load failed', e);
    }
  }

  function closePopup() { const p = $('blinkPopup'); if (p) p.classList.add('hidden'); }

  // ── chat panel ─────────────────────────────────────────────────────────────
  function openChat() {
    let panel = $('blinkChatPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'blinkChatPanel';
      panel.className = 'blink-chat-panel';
      panel.innerHTML = `
        <div class="blink-chat-head">
          <span>BlinkBot <small>· on-device</small></span>
          <button id="blinkChatClose" type="button">✕</button>
        </div>
        <div class="blink-chat-log" id="blinkChatLog">
          <div class="blink-msg bot">Online. Tell me what you did — e.g. “ran 5k and ticked meditation”.</div>
        </div>
        <div class="blink-chat-input">
          <input id="blinkChatInput" type="text" placeholder="Talk to BlinkBot…" autocomplete="off">
          <button id="blinkChatSend" type="button">Send</button>
        </div>`;
      document.body.appendChild(panel);
      $('blinkChatClose').onclick = () => panel.classList.add('hidden');
      $('blinkChatSend').onclick = sendMsg;
      $('blinkChatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMsg(); });
    }
    panel.classList.remove('hidden');
    $('blinkChatInput').focus();
  }

  function addMsg(text, who) {
    const log = $('blinkChatLog');
    const d = document.createElement('div');
    d.className = 'blink-msg ' + who;
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

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

  async function sendMsg() {
    const inp = $('blinkChatInput');
    const msg = (inp.value || '').trim();
    if (!msg || !wllama) return;
    inp.value = '';
    addMsg(msg, 'user');
    const thinking = addMsg('…', 'bot');

    let parsed;
    try {
      const raw = await wllama.createChatCompletion(
        [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: msg }],
        { nPredict: 256, sampling: { temp: 0.1 } });
      parsed = parseOut(typeof raw === 'string' ? raw : (raw?.content || ''));
    } catch (e) {
      thinking.textContent = 'BlinkBot error.'; console.error(e); return;
    }
    if (!parsed) { thinking.textContent = "Couldn't read that as a command."; return; }

    // Send the parsed result to the server to execute (raw text stays local).
    const r = await api('/pug/api/blinkbot', {
      message: parsed.needs_groq ? msg : undefined,
      actions: parsed.actions, needs_groq: parsed.needs_groq, reply: parsed.reply,
    });
    if (r.code === 402 && r.json.paywall) {
      thinking.textContent = r.json.reply || 'Free period ended.';
      offerRenew();
      return;
    }
    thinking.textContent = r.json.reply || 'ok';
    if (Array.isArray(r.json.pending_confirm) && r.json.pending_confirm.length) {
      r.json.pending_confirm.forEach(p => offerConfirm(p));
    }
    handleNav(r.json.nav);
  }

  function offerConfirm(pending) {
    const log = $('blinkChatLog');
    const row = document.createElement('div');
    row.className = 'blink-msg bot blink-confirm';
    row.innerHTML = `<span>${pending.summary}</span> `;
    const yes = document.createElement('button'); yes.textContent = 'Yes';
    const no  = document.createElement('button'); no.textContent  = 'No';
    yes.onclick = async () => {
      const r = await api('/pug/api/blinkbot', { confirm_action: pending.action });
      row.textContent = (r.json && r.json.reply) || 'done';
    };
    no.onclick = () => { row.textContent = 'Cancelled.'; };
    row.appendChild(yes); row.appendChild(no);
    log.appendChild(row); log.scrollTop = log.scrollHeight;
  }

  async function offerRenew() {
    const r = await api('/pug/api/blinkbot/pay', {});
    if (r.ok) { status = r.json; renderCard(); addMsg('Renewed — 30 more days.', 'bot'); }
    else if (r.json.error === 'insufficient_credits')
      addMsg(`Need ${r.json.need} credits (you have ${r.json.have}). Top up in your wallet.`, 'bot');
  }

  function handleNav(nav) {
    if (!nav) return;
    if (nav.action === 'logout') window.location.href = '/logout';
    // open_profile etc. left to the host app's router; emit an event it can hook.
    document.dispatchEvent(new CustomEvent('blinkbot:nav', { detail: nav }));
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
      .blink-chat-panel{position:fixed;right:18px;bottom:18px;z-index:9998;width:340px;max-width:92vw;
        height:460px;max-height:74vh;display:flex;flex-direction:column;background:var(--surface-1,#15161a);
        border:1px solid var(--border2,#2a2c33);border-radius:14px;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.5)}
      .blink-chat-panel.hidden{display:none}
      .blink-chat-head{display:flex;justify-content:space-between;align-items:center;padding:11px 14px;
        border-bottom:1px solid var(--border2,#2a2c33);font-weight:600;font-size:14px;color:var(--text,#e6e6e6)}
      .blink-chat-head small{color:var(--text-dim,#8b909a);font-weight:400}
      .blink-chat-head button{background:none;border:none;color:var(--text-dim,#8b909a);font-size:15px;cursor:pointer}
      .blink-chat-log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
      .blink-msg{max-width:85%;padding:8px 11px;border-radius:11px;font-size:13px;line-height:1.4;white-space:pre-wrap}
      .blink-msg.bot{align-self:flex-start;background:var(--surface-2,#23252c);color:var(--text,#dfe2e8)}
      .blink-msg.user{align-self:flex-end;background:var(--accent,#6c8cff);color:#fff}
      .blink-confirm button{margin-left:6px;padding:3px 10px;border-radius:7px;border:none;cursor:pointer;font-size:12px}
      .blink-confirm button:first-of-type{background:var(--accent,#6c8cff);color:#fff}
      .blink-chat-input{display:flex;gap:8px;padding:10px;border-top:1px solid var(--border2,#2a2c33)}
      .blink-chat-input input{flex:1;padding:8px 11px;border-radius:9px;border:1px solid var(--border2,#2a2c33);
        background:var(--surface-2,#1d1f25);color:var(--text,#e6e6e6);font-size:13px}
      .blink-chat-input button{padding:8px 15px;border-radius:9px;border:none;background:var(--accent,#6c8cff);color:#fff;font-weight:600;cursor:pointer}`;
    document.head.appendChild(s);
  }

  // ── wire up ────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const card = $('rGroqCard'), btn = $('blinkCardBtn');
    if (!card) return;
    injectStyles();
    refreshStatus();
    const onActivate = (e) => {
      e.stopPropagation();
      if (localStorage.getItem(LS_INSTALLED) === '1' && status.activated && !status.expired) {
        if (!wllama) { openPopup(); startDownload(); } else openChat();   // reload engine if page refreshed
      } else {
        openPopup();
      }
    };
    card.addEventListener('click', onActivate);
    if (btn) btn.addEventListener('click', onActivate);
  });
})();
