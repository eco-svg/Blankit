document.addEventListener('DOMContentLoaded', () => {

    const addBtn    = document.getElementById('newAchievementBtn');
    const modal     = document.getElementById('addAchievementModal');
    const cancelBtn = document.getElementById('cancelAchievementBtn');
    const confirmBtn= document.getElementById('confirmAchievementBtn');
    const titleInput= document.getElementById('achievementTitleInput');
    const descInput = document.getElementById('achievementDescInput');
    const proofInput= document.getElementById('achievementProofInput');
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
        const proofHtml = a.proof
            ? `<a href="${a.proof}" target="_blank" rel="noopener"
                  style="display:inline-block;margin-top:4px;font-size:0.72rem;color:var(--accent);
                         opacity:0.8;word-break:break-all;font-family:var(--font-mono);"
                  title="${a.proof}">&#128279; proof</a>`
            : '';
        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div>
                    <div class="achievement-title">${a.title}</div>
                    ${a.desc ? `<div class="achievement-desc">${a.desc}</div>` : ''}
                    ${proofHtml}
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
        if (proofInput) proofInput.value = '';
        modal.classList.remove('hidden');
        setTimeout(() => titleInput.focus(), 50);
    });

    cancelBtn?.addEventListener('click', () => modal.classList.add('hidden'));
    window.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

    titleInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') descInput.focus();
    });
    descInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') proofInput ? proofInput.focus() : submit();
    });
    proofInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') submit();
    });

    confirmBtn?.addEventListener('click', submit);

    function submit() {
        const title = titleInput.value.trim();
        if (!title) { titleInput.focus(); return; }
        const proof = proofInput?.value.trim() || '';
        fetch('/pug/api/achievements', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ title, description: descInput.value.trim(), proof })
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
