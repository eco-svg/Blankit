(function () {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  if (isStandalone) return; // already installed — hide button entirely

  let deferredPrompt = null;

  function showBtn() {
    document.querySelectorAll('.pwa-install-btn').forEach(b => b.classList.remove('pwa-hidden'));
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    showBtn();
  });

  window.addEventListener('appinstalled', () => {
    document.querySelectorAll('.pwa-install-btn').forEach(b => b.classList.add('pwa-hidden'));
  });

  document.addEventListener('click', async e => {
    const btn = e.target.closest('.pwa-install-btn');
    if (!btn) return;

    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome === 'accepted') {
        btn.classList.add('pwa-hidden');
      }
    } else if (isIOS) {
      // Show iOS tip
      let tip = document.getElementById('pwa-ios-tip');
      if (!tip) {
        tip = document.createElement('div');
        tip.id = 'pwa-ios-tip';
        tip.innerHTML = 'Tap <strong>Share</strong> → <strong>Add to Home Screen</strong> to install Veyra.';
        tip.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#e0e0e0;padding:12px 18px;border-radius:10px;font-size:13px;z-index:9999;max-width:280px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);';
        document.body.appendChild(tip);
        setTimeout(() => tip.remove(), 4000);
      }
    }
  });

  // On iOS show the button immediately (no beforeinstallprompt ever fires)
  if (isIOS) {
    document.addEventListener('DOMContentLoaded', showBtn);
  }
})();
