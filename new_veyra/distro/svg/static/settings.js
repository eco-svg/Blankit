/* ═══════════════════════════════════════
   settings.js — VEYRA settings page
   ═══════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  /* ── RESTORE THEME ── */
  const saved = localStorage.getItem('Eco-Svg-theme');
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
    localStorage.setItem('Eco-Svg-theme', theme);
  });

  /* ── ANIMATION TOGGLE ── */
  const animToggle = document.getElementById('animToggle');
  if (animToggle) {
    const noAnim = localStorage.getItem('Eco-Svg-no-anim') === 'true';
    document.body.classList.toggle('no-anim', noAnim);
    animToggle.setAttribute('aria-pressed', noAnim ? 'false' : 'true');
    animToggle.addEventListener('click', () => {
      const isOn = animToggle.getAttribute('aria-pressed') === 'true';
      animToggle.setAttribute('aria-pressed', isOn ? 'false' : 'true');
      document.body.classList.toggle('no-anim', isOn);
      localStorage.setItem('Eco-Svg-no-anim', isOn ? 'true' : 'false');
    });
  }

  /* ── LOGOUT ── */
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    localStorage.removeItem('veyra-locked-distro');
    window.location.href = '/';
  });

  /* ══════════════════════════════
     DELETE ACCOUNT
     ══════════════════════════════ */
  const deleteBtn     = document.getElementById('deleteAccountBtn');
  const deleteModal   = document.getElementById('deleteModal');
  const deleteBackdrop= document.getElementById('deleteModalBackdrop');
  const deleteCancel  = document.getElementById('deleteModalCancel');
  const deleteConfirm = document.getElementById('deleteModalConfirm');
  const deleteInput   = document.getElementById('deleteConfirmInput');
  const deleteFlash   = document.getElementById('deleteFlash');

  const CONFIRM_PHRASE = 'delete my account';

  function openDeleteModal() {
    deleteInput.value = '';
    deleteConfirm.disabled = true;
    deleteFlash.classList.add('hidden');
    deleteModal.classList.remove('hidden');
    deleteBackdrop.classList.remove('hidden');
    setTimeout(() => deleteInput.focus(), 100);
  }

  function closeDeleteModal() {
    deleteModal.classList.add('hidden');
    deleteBackdrop.classList.add('hidden');
  }

  deleteBtn.addEventListener('click', openDeleteModal);
  deleteCancel.addEventListener('click', closeDeleteModal);
  deleteBackdrop.addEventListener('click', closeDeleteModal);

  // enable confirm button only when phrase matches
  deleteInput.addEventListener('input', () => {
    deleteConfirm.disabled = deleteInput.value.trim() !== CONFIRM_PHRASE;
  });

  // confirm delete
  deleteConfirm.addEventListener('click', async () => {
    if (deleteInput.value.trim() !== CONFIRM_PHRASE) return;

    deleteConfirm.disabled  = true;
    deleteConfirm.textContent = 'Deleting…';

    try {
      const res  = await fetch('/auth/delete-account', { method: 'DELETE' });
      const data = await res.json();

      if (res.ok) {
        localStorage.clear();
        deleteFlash.textContent  = '✓ Account deleted. Redirecting…';
        deleteFlash.className    = 'delete-modal-flash success';
        deleteFlash.classList.remove('hidden');
        setTimeout(() => window.location.href = '/', 1500);
      } else {
        deleteFlash.textContent  = data.error || 'deletion failed';
        deleteFlash.className    = 'delete-modal-flash error';
        deleteFlash.classList.remove('hidden');
        deleteConfirm.disabled   = false;
        deleteConfirm.textContent = 'Delete permanently';
      }
    } catch {
      deleteFlash.textContent  = 'network error';
      deleteFlash.className    = 'delete-modal-flash error';
      deleteFlash.classList.remove('hidden');
      deleteConfirm.disabled   = false;
      deleteConfirm.textContent = 'Delete permanently';
    }
  });

});