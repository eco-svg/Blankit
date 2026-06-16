/* ═══════════════════════════════════════════════════════════════════════════
   clientlog.js — minimal remote error reporting.

   Catches uncaught JS errors + unhandled promise rejections on real user
   devices and beacons them to /pug/api/clientlog, which logs them server-side
   (→ Render logs). Deliberately privacy-light: it sends only the error text,
   where it happened (file:line / a tag), the stack, and the page PATH — never
   query strings, form values, message text, or anything the user typed.

   Also exposes window.blinkLog(tag, err) so code that swallows errors in a
   try/catch (which never reach window.onerror) can report them explicitly.
   ═══════════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';
  const ENDPOINT = '/pug/api/clientlog';
  const seen = new Set();           // dedupe identical errors within a session
  let sent = 0;                     // hard cap so a tight error loop can't flood

  function send(o) {
    try {
      if (sent >= 25) return;
      const key = (o.message || '') + '|' + (o.source || '');
      if (seen.has(key)) return;
      seen.add(key); sent++;
      o.page = location.pathname;   // path only — no query string, no fragments
      const body = JSON.stringify(o);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body, keepalive: true }).catch(() => {});
      }
    } catch (_) {}
  }

  // Capture phase so it also catches failed resource loads (404'd <script>/<link>),
  // which don't bubble — that's the same class of bug as a dead module URL.
  window.addEventListener('error', (e) => {
    const t = e.target;
    if (t && (t.src || t.href)) {        // resource load failure
      send({ message: 'resource load failed', source: (t.src || t.href || '').slice(0, 300) });
      return;
    }
    send({
      message: e.message || 'error',
      source:  (e.filename || '') + ':' + (e.lineno || 0) + ':' + (e.colno || 0),
      stack:   (e.error && e.error.stack) || '',
    });
  }, true);

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    send({
      message: (r && r.message) || String(r),
      source:  'unhandledrejection',
      stack:   (r && r.stack) || '',
    });
  });

  // For caught errors that never bubble to window.onerror (try/catch blocks).
  window.blinkLog = (tag, err) => send({
    message: (err && err.message) || String(err != null ? err : tag),
    source:  'tag:' + tag,
    stack:   (err && err.stack) || '',
  });
})();
