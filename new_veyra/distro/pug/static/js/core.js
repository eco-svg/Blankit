/* Veyra core: router, api, theme, toast, modal, utils. */
(function () {
  'use strict';

  const V = window.Veyra = {
    username: document.body.dataset.username || 'User',
    isAdmin:  document.body.dataset.admin === '1',
    onView:   {},   // view name -> [callbacks fired when view becomes active]
  };

  // ── utils ──────────────────────────────────────────────────
  V.$  = (sel, root) => (root || document).querySelector(sel);
  V.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  V.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  V.timeAgo = function (iso) {
    if (!iso) return '';
    const s = (Date.now() - new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).getTime()) / 1000;
    if (s < 60)        return 'now';
    if (s < 3600)      return Math.floor(s / 60) + 'm';
    if (s < 86400)     return Math.floor(s / 3600) + 'h';
    if (s < 86400 * 7) return Math.floor(s / 86400) + 'd';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  V.debounce = function (fn, ms) {
    let t;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  };

  // ── api ────────────────────────────────────────────────────
  V.api = async function (path, opts = {}) {
    const init = { headers: {} };
    if (opts.method) init.method = opts.method;
    if (opts.body !== undefined) {
      if (opts.body instanceof FormData) {
        init.body = opts.body;
      } else {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(opts.body);
      }
    }
    const res = await fetch(path, init);
    if (res.status === 401) { window.location.href = '/'; throw new Error('unauthenticated'); }
    let data = null;
    try { data = await res.json(); } catch (_) { /* non-JSON */ }
    if (!res.ok) {
      const err = new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  };

  // ── toast ──────────────────────────────────────────────────
  V.toast = function (msg, type) {
    const wrap = V.$('#toastWrap');
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' error' : '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; }, 2400);
    setTimeout(() => el.remove(), 2800);
  };

  // ── modal ──────────────────────────────────────────────────
  const backdrop = V.$('#modalBackdrop');
  const box      = V.$('#modalBox');

  V.modal = function (html) {
    box.innerHTML = html;
    backdrop.classList.add('open');
    return box;
  };
  V.closeModal = function () {
    backdrop.classList.remove('open');
    box.innerHTML = '';
  };
  backdrop.addEventListener('click', e => { if (e.target === backdrop) V.closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') V.closeModal(); });

  V.confirm = function ({ title, text, okLabel = 'Confirm', danger = false, withInput = null }) {
    return new Promise(resolve => {
      const m = V.modal(`
        <h3>${V.esc(title)}</h3>
        <div class="modal-sub">${V.esc(text)}</div>
        ${withInput ? `<input class="input" id="cfInput" type="${withInput.type || 'text'}" placeholder="${V.esc(withInput.placeholder || '')}">` : ''}
        <div class="modal-actions">
          <button class="btn ghost" id="cfNo">Cancel</button>
          <button class="btn ${danger ? 'danger' : ''}" id="cfYes">${V.esc(okLabel)}</button>
        </div>`);
      V.$('#cfNo', m).onclick = () => { V.closeModal(); resolve(null); };
      V.$('#cfYes', m).onclick = () => {
        const val = withInput ? V.$('#cfInput', m).value : true;
        V.closeModal();
        resolve(val);
      };
      if (withInput) V.$('#cfInput', m).focus();
    });
  };

  // ── theme ──────────────────────────────────────────────────
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('veyra2_theme', t);
    const lbl = V.$('#themeLabel');
    if (lbl) lbl.textContent = t === 'dark' ? 'Light mode' : 'Dark mode';
    V.$$('.theme-dot').forEach(d => d.classList.toggle('active', d.dataset.theme === t));
  }
  V.applyTheme = applyTheme;
  applyTheme(document.documentElement.getAttribute('data-theme') || 'light');

  function toggleTheme() {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  }
  const tt = V.$('#themeToggle');  if (tt) tt.addEventListener('click', toggleTheme);
  const tm = V.$('#themeToggleM'); if (tm) tm.addEventListener('click', toggleTheme);
  V.$$('.theme-dot').forEach(d => d.addEventListener('click', () => applyTheme(d.dataset.theme)));

  // ── router ─────────────────────────────────────────────────
  const TITLES = {
    dashboard: 'Dashboard', notes: 'Notes', goals: 'Goals', habits: 'Habits',
    skills: 'Skills', community: 'Community', messages: 'Messages', ask: 'Ask',
    wallet: 'Eyes Wallet', bots: 'AI Bots', profile: 'Profile',
  };
  const loaded = {};   // view -> bool, first-activation hooks already fired

  function navigate(view, push) {
    if (!TITLES[view]) view = 'dashboard';
    V.$$('.view').forEach(s => s.classList.toggle('active', s.dataset.view === view));
    V.$$('[data-view]').forEach(el => {
      if (el.classList.contains('view')) return;
      el.classList.toggle('active', el.dataset.view === view);
    });
    const t = TITLES[view];
    const tb = V.$('#topbarTitle');   if (tb) tb.textContent = t;
    const mt = V.$('#mobileTitle');   if (mt) mt.textContent = t;
    if (push) history.pushState({ view }, '', '#' + view);
    (V.onView[view] || []).forEach(fn => fn(!loaded[view]));
    loaded[view] = true;
    const c = V.$('.content'); if (c) window.scrollTo({ top: 0 });
  }
  V.navigate = v => navigate(v, true);
  V.when = function (view, fn) { (V.onView[view] = V.onView[view] || []).push(fn); };

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-view]');
    if (btn && !btn.classList.contains('view')) {
      navigate(btn.dataset.view, true);
    }
  });
  window.addEventListener('popstate', e => {
    navigate((e.state && e.state.view) || location.hash.replace('#', '') || 'dashboard', false);
  });

  // ── boot ───────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const start = location.hash.replace('#', '') || 'dashboard';
    navigate(start, false);
    history.replaceState({ view: start }, '', '#' + start);
  });
})();
