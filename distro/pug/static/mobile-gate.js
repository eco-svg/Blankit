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
