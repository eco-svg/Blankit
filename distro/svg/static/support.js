/* ═══════════════════════════════════════
   support.js — VEYRA support page
   ═══════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  /* ── THEME ── */
  const saved = localStorage.getItem('ecosvg-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  /* ── SIDEBAR ── */
  const toggle   = document.getElementById('sidebarToggle');
  const sidebar  = document.getElementById('sidebar');
  const close    = document.getElementById('sidebarClose');
  const backdrop = document.getElementById('sidebarBackdrop');

  toggle?.addEventListener('click',   () => { sidebar.classList.add('open');    backdrop.classList.remove('hidden'); });
  close?.addEventListener('click',    () => { sidebar.classList.remove('open'); backdrop.classList.add('hidden'); });
  backdrop?.addEventListener('click', () => { sidebar.classList.remove('open'); backdrop.classList.add('hidden'); });

});