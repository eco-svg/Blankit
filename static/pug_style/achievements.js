document.addEventListener('DOMContentLoaded', () => {

    const addBtn    = document.getElementById('newAchievementBtn');
    const modal     = document.getElementById('addAchievementModal');
    const cancelBtn = document.getElementById('cancelAchievementBtn');
    const confirmBtn= document.getElementById('confirmAchievementBtn');
    const titleInput= document.getElementById('achievementTitleInput');
    const descInput = document.getElementById('achievementDescInput');
    const proofInput= document.getElementById('achievementProofInput');
    const list      = document.getElementById('achievementsList');

    // ── Verify modal ──────────────────────────────────────────────────────────
    const verifyModal    = document.getElementById('verifyWorkModal');
    const verifyTitle    = document.getElementById('verifyWorkTitle');
    const verifyTabs     = document.querySelectorAll('.verify-tab');
    const verifyTabLink  = document.getElementById('verifyTabLink');
    const verifyTabMedia = document.getElementById('verifyTabMedia');
    const verifyLinkIn   = document.getElementById('verifyLinkInput');
    const verifyMediaIn  = document.getElementById('verifyMediaInput');
    const verifyUploadLbl= document.getElementById('verifyUploadLabel');
    const verifyUploadTxt= document.getElementById('verifyUploadText');
    const verifyError    = document.getElementById('verifyError');
    const cancelVerifyBtn= document.getElementById('cancelVerifyBtn');
    const confirmVerifyBtn=document.getElementById('confirmVerifyBtn');

    let verifyTargetId = null;
    let verifyActiveTab = 'link';
    let verifyFile = null;

    verifyTabs.forEach(t => t.addEventListener('click', () => {
        verifyActiveTab = t.dataset.tab;
        verifyTabs.forEach(b => b.classList.toggle('active', b.dataset.tab === verifyActiveTab));
        verifyTabLink.classList.toggle('hidden',  verifyActiveTab !== 'link');
        verifyTabMedia.classList.toggle('hidden', verifyActiveTab !== 'media');
    }));

    verifyMediaIn?.addEventListener('change', e => {
        verifyFile = e.target.files[0] || null;
        if (verifyUploadTxt) verifyUploadTxt.textContent = verifyFile ? verifyFile.name : 'Choose audio / video / image';
    });

    function openVerify(id, title) {
        verifyTargetId = id;
        verifyFile = null;
        verifyActiveTab = 'link';
        verifyTabs.forEach(b => b.classList.toggle('active', b.dataset.tab === 'link'));
        verifyTabLink.classList.remove('hidden');
        verifyTabMedia.classList.add('hidden');
        if (verifyLinkIn)    verifyLinkIn.value = '';
        if (verifyMediaIn)   verifyMediaIn.value = '';
        if (verifyUploadTxt) verifyUploadTxt.textContent = 'Choose audio / video / image';
        if (verifyTitle)     verifyTitle.textContent = title;
        if (verifyError)     verifyError.textContent = '';
        verifyModal?.classList.remove('hidden');
        setTimeout(() => verifyLinkIn?.focus(), 50);
    }

    cancelVerifyBtn?.addEventListener('click', () => verifyModal?.classList.add('hidden'));
    window.addEventListener('click', e => { if (e.target === verifyModal) verifyModal?.classList.add('hidden'); });

    confirmVerifyBtn?.addEventListener('click', submitVerify);

    async function submitVerify() {
        if (!verifyTargetId) return;
        if (verifyError) verifyError.textContent = '';
        confirmVerifyBtn.disabled = true;

        try {
            let res;
            if (verifyActiveTab === 'link') {
                const link = verifyLinkIn?.value.trim();
                if (!link) { if (verifyError) verifyError.textContent = 'Enter a URL.'; confirmVerifyBtn.disabled = false; return; }
                res = await fetch(`/pug/api/achievements/${verifyTargetId}/verify`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ link })
                });
            } else {
                if (!verifyFile) { if (verifyError) verifyError.textContent = 'Choose a file first.'; confirmVerifyBtn.disabled = false; return; }
                if (verifyFile.size > 50 * 1024 * 1024) { if (verifyError) verifyError.textContent = 'File too large — max 50 MB.'; confirmVerifyBtn.disabled = false; return; }
                const fd = new FormData();
                fd.append('media', verifyFile);
                res = await fetch(`/pug/api/achievements/${verifyTargetId}/verify`, { method: 'PATCH', body: fd });
            }
            const data = await res.json();
            confirmVerifyBtn.disabled = false;
            if (data.error) { if (verifyError) verifyError.textContent = data.error; return; }
            verifyModal?.classList.add('hidden');
            load();
        } catch {
            confirmVerifyBtn.disabled = false;
            if (verifyError) verifyError.textContent = 'Could not submit. Try again.';
        }
    }

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

    function verifiedBadge(v) {
        if (v === 'link')     return `<span class="ach-verified-badge link">✓ verified</span>`;
        if (v === 'pending')  return `<span class="ach-verified-badge pending">⏳ pending</span>`;
        if (v === 'approved') return `<span class="ach-verified-badge link">✓ approved</span>`;
        return '';
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
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        <span class="achievement-title">${a.title}</span>
                        ${verifiedBadge(a.verified)}
                    </div>
                    ${a.desc ? `<div class="achievement-desc">${a.desc}</div>` : ''}
                    ${proofHtml}
                </div>
                <div style="display:flex;gap:5px;flex-shrink:0;align-items:center;">
                    <button class="ach-verify-btn" data-id="${a.id}" data-title="${a.title.replace(/"/g,'&quot;')}"
                        title="Verify this work">verify</button>
                    <button class="ach-del-btn" title="Remove" data-id="${a.id}"
                        style="background:transparent;border:none;cursor:pointer;
                               color:var(--text-dim);font-size:1rem;padding:0 2px;line-height:1;">×</button>
                </div>
            </div>`;
        el.querySelector('.ach-del-btn').addEventListener('click', e => { e.stopPropagation(); del(a.id); });
        el.querySelector('.ach-verify-btn').addEventListener('click', e => { e.stopPropagation(); openVerify(a.id, a.title); });
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
