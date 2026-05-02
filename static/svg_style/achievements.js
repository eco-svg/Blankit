/* ═══════════════════════════════════════════
   achievements.js — real API data per user
   ═══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {

  /* ── THEME ── */
  const saved = localStorage.getItem('ecosvg-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  /* ══════════════════════════════
     SLIDE PANEL
     ══════════════════════════════ */
  const achPanel         = document.getElementById('achPanel');
  const achPanelTrigger  = document.getElementById('achPanelTrigger');
  const achPanelClose    = document.getElementById('achPanelClose');
  const achPanelBackdrop = document.getElementById('achPanelBackdrop');

  function openPanel()  { achPanel?.classList.add('open');    achPanelBackdrop?.classList.remove('hidden'); }
  function closePanel() { achPanel?.classList.remove('open'); achPanelBackdrop?.classList.add('hidden'); }

  achPanelTrigger?.addEventListener('click', openPanel);
  achPanelClose?.addEventListener('click', closePanel);
  achPanelBackdrop?.addEventListener('click', closePanel);
  document.querySelectorAll('.ach-panel-link').forEach(l => l.addEventListener('click', closePanel));

  /* ══════════════════════════════
     FETCH BADGES FROM API
     ══════════════════════════════ */
  let allBadges = [];

  async function fetchBadges() {
    try {
      const res  = await fetch('/api/badges');
      allBadges  = await res.json();
      renderBadgeList();
      renderPodiumFromBadges();
    } catch(e) {
      console.error('Badges load failed', e);
    }
  }

  /* ══════════════════════════════
     RENDER BADGE LIST
     ══════════════════════════════ */
  function renderBadgeList() {
    const container = document.getElementById('achBadgesList');
    if (!container) return;
    container.innerHTML = '';

    allBadges.forEach(b => {
      const earned = b.earned;
      const div    = document.createElement('div');
      div.className      = `ach-badge ${earned ? 'earned' : 'locked'}`;
      div.dataset.id     = b.id;
      div.dataset.icon   = b.icon || '🏅';
      div.dataset.name   = b.name;

      div.innerHTML = `
        <div class="ach-badge-icon">${b.icon || '🏅'}</div>
        <div class="ach-badge-body">
          <div class="ach-badge-name">${b.name}</div>
          <div class="ach-badge-desc">${b.description || ''}</div>
        </div>
        ${earned
          ? `<button class="ach-badge-pin" title="Pin to podium">⊕</button>
             <span class="ach-badge-rank-tag" id="tag-${b.id}"></span>`
          : `<span class="ach-badge-lock">🔒</span>`
        }`;

      if (earned) {
        div.querySelector('.ach-badge-pin').addEventListener('click', e => {
          e.stopPropagation();
          openRankModal({ id: b.id, icon: b.icon || '🏅', name: b.name });
        });
      }

      container.appendChild(div);
    });

    renderTags();
  }

  /* ══════════════════════════════
     PODIUM — read from badge API podium_rank
     ══════════════════════════════ */
  function renderPodiumFromBadges() {
    // clear
    [1,2,3].forEach(rank => {
      const iconEl = document.getElementById(`podium-icon-${rank}`);
      const nameEl = document.getElementById(`podium-name-${rank}`);
      if (iconEl) iconEl.textContent = '—';
      if (nameEl) { nameEl.textContent = 'empty'; nameEl.style.color = 'var(--clr-text-muted, #7a9e84)'; }
    });

    allBadges.forEach(b => {
      if (!b.earned || !b.podium_rank) return;
      const rank   = b.podium_rank;
      const iconEl = document.getElementById(`podium-icon-${rank}`);
      const nameEl = document.getElementById(`podium-name-${rank}`);
      if (iconEl) iconEl.textContent = b.icon || '🏅';
      if (nameEl) { nameEl.textContent = b.name; nameEl.style.color = ''; }
    });
  }

  function renderTags() {
    document.querySelectorAll('.ach-badge-rank-tag').forEach(tag => {
      tag.textContent = '';
      tag.classList.remove('visible');
    });

    const rankLabels = { 1:'I', 2:'II', 3:'III' };
    allBadges.forEach(b => {
      if (!b.earned || !b.podium_rank) return;
      const tag = document.getElementById(`tag-${b.id}`);
      if (tag) {
        tag.textContent = rankLabels[b.podium_rank] || '';
        tag.classList.add('visible');
      }
    });
  }

  /* ══════════════════════════════
     RANK PICKER MODAL
     ══════════════════════════════ */
  const rankModal         = document.getElementById('rankModal');
  const rankModalBackdrop = document.getElementById('rankModalBackdrop');
  const rankModalSub      = document.getElementById('rankModalSub');
  const rankModalCancel   = document.getElementById('rankModalCancel');
  let pendingBadge = null;

  function openRankModal(badge) {
    pendingBadge = badge;
    if (rankModalSub) rankModalSub.textContent = `"${badge.name}"`;
    rankModal?.classList.remove('hidden');
    rankModalBackdrop?.classList.remove('hidden');
  }

  function closeRankModal() {
    rankModal?.classList.add('hidden');
    rankModalBackdrop?.classList.add('hidden');
    pendingBadge = null;
  }

  rankModalCancel?.addEventListener('click', closeRankModal);
  rankModalBackdrop?.addEventListener('click', closeRankModal);

  document.querySelectorAll('.rank-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!pendingBadge) return;
      const rank = parseInt(btn.dataset.rank);
      try {
        const res = await fetch(`/api/badges/${pendingBadge.id}/podium`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ rank }),
        });
        if (res.ok) {
          // update local data and re-render
          allBadges = allBadges.map(b => {
            if (b.podium_rank === rank) return { ...b, podium_rank: null };
            if (b.id === pendingBadge.id) return { ...b, podium_rank: rank };
            return b;
          });
          renderPodiumFromBadges();
          renderTags();
        }
      } catch(e) {
        console.error('Podium set failed', e);
      }
      closeRankModal();
    });
  });

  /* ── INIT ── */
  await fetchBadges();
});