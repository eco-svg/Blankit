/* ═══════════════════════════════════════
   settings.js — Blankit settings page
   ═══════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  /* ── RESTORE THEME ON PAGE LOAD ── */
  const saved = localStorage.getItem('ecosvg-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
    document.querySelectorAll('.theme-card').forEach(c => {
      c.classList.toggle('active', c.dataset.theme === saved);
    });
  }

  /* ── THEME CARDS ── */
  document.getElementById('themeCards').addEventListener('click', e => {
    const card = e.target.closest('.theme-card');
    if (!card) return;
    const theme = card.dataset.theme;
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    localStorage.setItem('ecosvg-theme', theme);
  });

  /* ── ANIMATION TOGGLE ── */
  const animToggle = document.getElementById('animToggle');
  if (animToggle) {
    const noAnim = localStorage.getItem('ecosvg-no-anim') === 'true';
    document.body.classList.toggle('no-anim', noAnim);
    animToggle.setAttribute('aria-pressed', noAnim ? 'false' : 'true');

    animToggle.addEventListener('click', () => {
      const isOn = animToggle.getAttribute('aria-pressed') === 'true';
      animToggle.setAttribute('aria-pressed', isOn ? 'false' : 'true');
      document.body.classList.toggle('no-anim', isOn);
      localStorage.setItem('ecosvg-no-anim', isOn ? 'true' : 'false');
    });
  }

  /* ── LOGOUT ── */
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.href = '/';
  });

});