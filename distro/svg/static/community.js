/* ═══════════════════════════════════════
   community.js — coming soon page
   ═══════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  /* ── RESTORE THEME ── */
  const saved = localStorage.getItem('Eco-Svg-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  /* ── NOTIFY BUTTON ── */
  const notifyBtn   = document.getElementById('notifyBtn');
  const notifyFlash = document.getElementById('notifyFlash');

  if (notifyBtn) {
    notifyBtn.addEventListener('click', () => {
      notifyBtn.textContent   = '✓ Done!';
      notifyBtn.disabled      = true;
      notifyBtn.style.opacity = '0.6';
      if (notifyFlash) {
        notifyFlash.classList.remove('hidden');
        setTimeout(() => notifyFlash.classList.add('hidden'), 3000);
      }
    });
  }

});