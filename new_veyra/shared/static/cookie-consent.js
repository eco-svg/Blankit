(function () {
  var KEY = 'veyra_cookie_consent';
  if (localStorage.getItem(KEY)) return;

  var css = [
    '#veyra-cookie-banner{position:fixed;bottom:0;left:0;right:0;z-index:99999;',
    'background:rgba(14,12,9,0.97);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);',
    'border-top:1px solid rgba(255,255,255,0.08);padding:16px 20px;',
    'display:flex;align-items:center;gap:16px;flex-wrap:wrap;}',
    '#veyra-cookie-banner .vc-text{flex:1;min-width:200px;font-family:sans-serif;',
    'font-size:0.8rem;color:rgba(255,255,255,0.55);line-height:1.5;}',
    '#veyra-cookie-banner .vc-text a{color:rgba(212,165,116,0.85);text-decoration:none;}',
    '#veyra-cookie-banner .vc-text a:hover{text-decoration:underline;}',
    '#veyra-cookie-banner .vc-btns{display:flex;gap:8px;flex-shrink:0;}',
    '#veyra-cookie-banner .vc-btn{font-family:sans-serif;font-size:0.75rem;padding:7px 16px;',
    'border-radius:6px;border:none;cursor:pointer;white-space:nowrap;transition:opacity 0.15s;}',
    '#veyra-cookie-banner .vc-btn:hover{opacity:0.85;}',
    '#veyra-cookie-banner .vc-accept{background:#d4a574;color:#0e0c09;font-weight:600;}',
    '#veyra-cookie-banner .vc-necessary{background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.6);}',
    '@media(max-width:520px){#veyra-cookie-banner{flex-direction:column;align-items:stretch;}',
    '#veyra-cookie-banner .vc-btns{justify-content:flex-end;}}'
  ].join('');

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var banner = document.createElement('div');
  banner.id = 'veyra-cookie-banner';
  banner.innerHTML = [
    '<div class="vc-text">',
    'We use essential cookies to keep you signed in. With your consent we may also use analytics to improve the platform. ',
    'See our <a href="/privacy" target="_blank">Privacy Policy</a>.',
    '</div>',
    '<div class="vc-btns">',
    '<button class="vc-btn vc-necessary" id="vc-btn-necessary">Necessary only</button>',
    '<button class="vc-btn vc-accept" id="vc-btn-accept">Accept all</button>',
    '</div>'
  ].join('');

  function dismiss(choice) {
    localStorage.setItem(KEY, choice);
    banner.style.transition = 'opacity 0.25s';
    banner.style.opacity = '0';
    setTimeout(function () { banner.remove(); }, 260);
  }

  document.body.appendChild(banner);

  document.getElementById('vc-btn-accept').addEventListener('click', function () { dismiss('all'); });
  document.getElementById('vc-btn-necessary').addEventListener('click', function () { dismiss('necessary'); });
})();
