/* ═══════════════════════════════════════════
   achievements.js
   ═══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  /* ══════════════════════════════
     RIGHT SLIDE PANEL
     ══════════════════════════════ */
  const achPanel          = document.getElementById('achPanel');
  const achPanelTrigger   = document.getElementById('achPanelTrigger');
  const achPanelClose     = document.getElementById('achPanelClose');
  const achPanelBackdrop  = document.getElementById('achPanelBackdrop');

  function openAchPanel() {
    achPanel.classList.add('open');
    achPanelBackdrop.classList.remove('hidden');
  }
  function closeAchPanel() {
    achPanel.classList.remove('open');
    achPanelBackdrop.classList.add('hidden');
  }

  if (achPanelTrigger) achPanelTrigger.addEventListener('click', openAchPanel);
  if (achPanelClose)   achPanelClose.addEventListener('click', closeAchPanel);
  if (achPanelBackdrop) achPanelBackdrop.addEventListener('click', closeAchPanel);

  // clicking panel links closes panel and scrolls smoothly
  document.querySelectorAll('.ach-panel-link').forEach(link => {
    link.addEventListener('click', () => closeAchPanel());
  });

  /* ══════════════════════════════
     PODIUM STATE
     podium = { 1: {id, icon, name}, 2: {...}, 3: {...} }
     ══════════════════════════════ */
  const STORAGE_KEY = 'ecosvg-podium';

  function loadPodium() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
  }

  function savePodium(podium) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(podium));
  }

  function renderPodium(podium) {
    [1, 2, 3].forEach(rank => {
      const entry    = podium[rank];
      const iconEl   = document.getElementById(`podium-icon-${rank}`);
      const nameEl   = document.getElementById(`podium-name-${rank}`);
      if (!iconEl || !nameEl) return;

      if (entry) {
        iconEl.textContent = entry.icon;
        nameEl.textContent = entry.name;
        nameEl.style.color = 'var(--text)';
      } else {
        iconEl.textContent = '—';
        nameEl.textContent = 'empty';
        nameEl.style.color = 'var(--text3)';
      }
    });
  }

  function renderTags(podium) {
    // clear all tags first
    document.querySelectorAll('.ach-badge-rank-tag').forEach(tag => {
      tag.textContent = '';
      tag.classList.remove('visible');
    });

    const rankLabels = { 1: 'I', 2: 'II', 3: 'III' };
    Object.entries(podium).forEach(([rank, entry]) => {
      if (!entry) return;
      const tag = document.getElementById(`tag-${entry.id}`);
      if (tag) {
        tag.textContent = rankLabels[rank];
        tag.classList.add('visible');
      }
    });
  }

  // init on load
  const podium = loadPodium();
  renderPodium(podium);
  renderTags(podium);

  /* ══════════════════════════════
     RANK PICKER MODAL
     ══════════════════════════════ */
  const rankModal         = document.getElementById('rankModal');
  const rankModalBackdrop = document.getElementById('rankModalBackdrop');
  const rankModalSub      = document.getElementById('rankModalSub');
  const rankModalCancel   = document.getElementById('rankModalCancel');

  let pendingBadge = null; // {id, icon, name}

  function openRankModal(badge) {
    pendingBadge = badge;
    rankModalSub.textContent = `"${badge.name}"`;
    rankModal.classList.remove('hidden');
    rankModalBackdrop.classList.remove('hidden');
  }

  function closeRankModal() {
    rankModal.classList.add('hidden');
    rankModalBackdrop.classList.add('hidden');
    pendingBadge = null;
  }

  if (rankModalCancel)   rankModalCancel.addEventListener('click', closeRankModal);
  if (rankModalBackdrop) rankModalBackdrop.addEventListener('click', closeRankModal);

  // rank option buttons
  document.querySelectorAll('.rank-option').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!pendingBadge) return;
      const rank = parseInt(btn.dataset.rank);
      const fresh = loadPodium();

      // if badge already on podium at another rank, remove it
      Object.keys(fresh).forEach(r => {
        if (fresh[r] && fresh[r].id === pendingBadge.id) delete fresh[r];
      });

      fresh[rank] = { id: pendingBadge.id, icon: pendingBadge.icon, name: pendingBadge.name };
      savePodium(fresh);
      renderPodium(fresh);
      renderTags(fresh);
      closeRankModal();
    });
  });

  /* ══════════════════════════════
     PIN BUTTONS on badges
     ══════════════════════════════ */
  document.querySelectorAll('.ach-badge.earned').forEach(badge => {
    const pinBtn = badge.querySelector('.ach-badge-pin');
    if (!pinBtn) return;

    pinBtn.addEventListener('click', e => {
      e.stopPropagation();
      openRankModal({
        id:   badge.dataset.id,
        icon: badge.dataset.icon,
        name: badge.dataset.name,
      });
    });
  });

});