document.addEventListener('DOMContentLoaded', () => {

    const addBtn    = document.getElementById('newAchievementBtn');
    const modal     = document.getElementById('addAchievementModal');
    const cancelBtn = document.getElementById('cancelAchievementBtn');
    const confirmBtn= document.getElementById('confirmAchievementBtn');
    const titleInput= document.getElementById('achievementTitleInput');
    const descInput = document.getElementById('achievementDescInput');
    const list      = document.getElementById('achievementsList');

    // ── Load ──────────────────────────────────────────────────────────────────
    function load() {
        fetch('/pug/api/achievements')
            .then(r => r.json())
            .then(items => {
                list.innerHTML = '';
                if (!items.length) {
                    list.innerHTML = '<div class="skill-loading" style="margin-top:30px;opacity:0.45;">Projects. Releases. Results.<br>No certs — real output only.</div>';
                    return;
                }
                items.forEach(a => list.appendChild(makeItem(a)));
            })
            .catch(() => {});
    }

    function makeItem(a) {
        const el = document.createElement('div');
        el.className = 'achievement-item';
        el.dataset.id = a.id;
        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div>
                    <div class="achievement-title">${a.title}</div>
                    ${a.body ? `<div class="achievement-desc">${a.body}</div>` : ''}
                </div>
                <button class="ach-del-btn" title="Remove" data-id="${a.id}"
                    style="flex-shrink:0;background:transparent;border:none;cursor:pointer;
                           color:var(--text-dim);font-size:1rem;padding:0 2px;line-height:1;">×</button>
            </div>`;
        el.querySelector('.ach-del-btn').addEventListener('click', e => {
            e.stopPropagation();
            del(a.id);
        });
        return el;
    }

    function del(id) {
        fetch(`/pug/api/achievements/${id}`, { method: 'DELETE' })
            .then(() => load())
            .catch(() => {});
    }

    // ── Add modal ─────────────────────────────────────────────────────────────
    addBtn?.addEventListener('click', () => {
        titleInput.value = '';
        descInput.value  = '';
        modal.classList.remove('hidden');
        setTimeout(() => titleInput.focus(), 50);
    });

    cancelBtn?.addEventListener('click', () => modal.classList.add('hidden'));
    window.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

    titleInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') descInput.focus();
    });
    descInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') submit();
    });

    confirmBtn?.addEventListener('click', submit);

    function submit() {
        const title = titleInput.value.trim();
        if (!title) { titleInput.focus(); return; }
        fetch('/pug/api/achievements', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ title, description: descInput.value.trim() })
        })
        .then(r => r.json())
        .then(data => {
            if (data.error) return;
            modal.classList.add('hidden');
            load();
        })
        .catch(() => {});
    }

    load();
});
