/**
 * mobile-gate.js — Veyra is desktop-only for now. On a phone / small screen we (1) force
 * the DESKTOP layout by pinning the viewport to a fixed desktop width so the mobile CSS
 * never kicks in, and (2) show a dismissible "best on desktop, mobile coming soon" notice.
 * Loaded early (in <head>) so the viewport is set before first layout.
 */
(function () {
  var isMobile = /Mobi|Android|iPhone|iPad|iPod|Windows Phone|BlackBerry|IEMobile/i.test(navigator.userAgent)
    || (window.matchMedia && window.matchMedia('(max-width: 820px)').matches);
  if (!isMobile) return;

  // Render the desktop layout (kstyle-mobile.css is max-width:768px → won't apply at 1280).
  var vp = document.querySelector('meta[name="viewport"]');
  if (vp) vp.setAttribute('content', 'width=1280');

  // Self-contained styles (with fallback colors) so the notice also works on pages
  // that don't load kstyle.css — e.g. the login/landing page (shown at app open).
  if (!document.getElementById('mgStyle')) {
    var st = document.createElement('style');
    st.id = 'mgStyle';
    st.textContent =
      '#mobileGate{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(6,7,9,0.82);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:24px;}' +
      '#mobileGate .mg-box{max-width:420px;width:100%;background:var(--surface-1,#15161a);border:1px solid var(--border2,#2a2c33);border-radius:18px;padding:30px 26px;text-align:center;box-shadow:0 24px 70px rgba(0,0,0,0.6);font-family:sans-serif;}' +
      '#mobileGate .mg-icon{font-size:3rem;line-height:1;margin-bottom:14px;}' +
      '#mobileGate .mg-title{font-size:1.45rem;font-weight:700;color:var(--text,#e6e6e6);margin-bottom:12px;}' +
      '#mobileGate .mg-text{font-size:0.95rem;line-height:1.6;color:var(--text-muted,#b6bcc6);margin-bottom:24px;}' +
      '#mobileGate .mg-btn{background:var(--accent,#d4a574);color:var(--text-on-accent,#1a1206);border:none;border-radius:11px;padding:12px 28px;font-size:1rem;font-weight:600;cursor:pointer;}' +
      '#mobileGate .mg-btn:hover{opacity:0.9;}';
    (document.head || document.documentElement).appendChild(st);
  }

  function showNotice() {
    if (document.getElementById('mobileGate')) return;
    var ov = document.createElement('div');
    ov.id = 'mobileGate';
    ov.innerHTML =
      '<div class="mg-box">' +
        '<div class="mg-icon">🖥️</div>' +
        '<div class="mg-title">Best on Desktop</div>' +
        '<div class="mg-text">Veyra is built for desktop right now — a mobile experience is rolling out soon.' +
        '<br><br>You can still come in: we’ll open the full desktop view, so pinch &amp; drag to get around.</div>' +
        '<button class="mg-btn" id="mgClose" type="button">Continue in desktop view</button>' +
      '</div>';
    document.body.appendChild(ov);
    var btn = document.getElementById('mgClose');
    if (btn) btn.onclick = function () { ov.remove(); };
  }

  if (document.body) showNotice();
  else document.addEventListener('DOMContentLoaded', showNotice);
})();
