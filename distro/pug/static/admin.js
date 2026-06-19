/**
 * admin.js — Admin moderation panel (only loaded for admin accounts).
 * Reported-posts queue + reported-users queue, driven by the /pug/api/admin/* endpoints.
 * Entry: Profile → "Admin Panel" button → navigates to the #admin route.
 */
document.addEventListener('DOMContentLoaded', () => {
    const openBtn    = document.getElementById('openAdminPanelBtn');
    const refreshBtn = document.getElementById('adminRefreshBtn');
    const postsList  = document.getElementById('adminPostsList');
    const usersList  = document.getElementById('adminUsersList');
    const postsCount = document.getElementById('adminPostsCount');
    const usersCount = document.getElementById('adminUsersCount');
    if (!postsList || !usersList) return;   // card not on the page (non-admin)

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function fmtWhen(iso) {
        if (!iso) return '';
        try { return new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).toLocaleString(); }
        catch (e) { return iso; }
    }
    function toast(msg) {
        let t = document.querySelector('.comm-toast');
        if (!t) { t = document.createElement('div'); t.className = 'comm-toast'; document.body.appendChild(t); }
        t.textContent = msg;
        requestAnimationFrame(() => t.classList.add('show'));
        clearTimeout(t._h);
        t._h = setTimeout(() => t.classList.remove('show'), 2600);
    }

    // ── Reported posts ─────────────────────────────────────────────────────────
    function loadPosts() {
        postsList.innerHTML = '<div class="admin-empty">Loading…</div>';
        fetch('/pug/api/admin/reports').then(r => r.json()).then(rows => {
            if (postsCount) postsCount.textContent = rows.length ? rows.length : '';
            if (!rows.length) { postsList.innerHTML = '<div class="admin-empty">No reported posts. 🎉</div>'; return; }
            postsList.innerHTML = '';
            rows.forEach(p => {
                const el = document.createElement('div');
                el.className = 'admin-row' + (p.is_hidden ? ' admin-row-hidden' : '');
                el.innerHTML = `
                    <div class="admin-row-main">
                        <div class="admin-row-head">
                            <span class="admin-row-author">${esc(p.author)}</span>
                            <span class="admin-row-badge">${p.report_count} report${p.report_count === 1 ? '' : 's'}</span>
                            ${p.is_hidden ? '<span class="admin-row-badge admin-badge-warn">auto-hidden</span>' : ''}
                            <span class="admin-row-when">${esc(fmtWhen(p.created_at))}</span>
                        </div>
                        <div class="admin-row-text">${esc(p.text) || '<i>(media-only post)</i>'}</div>
                        ${p.reasons && p.reasons.length ? `<div class="admin-row-reasons">${p.reasons.map(r => `<span>${esc(r)}</span>`).join('')}</div>` : ''}
                    </div>
                    <div class="admin-row-actions">
                        <button class="admin-act admin-act-keep" data-act="keep">Keep</button>
                        <button class="admin-act admin-act-remove" data-act="remove">Remove</button>
                        <button class="admin-act" data-act="mute" data-uid="${p.author_id}">Mute author</button>
                    </div>`;
                el.querySelector('[data-act="keep"]').onclick = () => postAction(p.id, 'keep', el);
                el.querySelector('[data-act="remove"]').onclick = () => {
                    if (confirm('Remove this post for good?')) postAction(p.id, 'remove', el);
                };
                el.querySelector('[data-act="mute"]').onclick = () => muteUser(p.author_id, p.author);
                postsList.appendChild(el);
            });
        }).catch(() => { postsList.innerHTML = '<div class="admin-empty">Failed to load.</div>'; });
    }

    function postAction(pid, action, el) {
        fetch(`/pug/api/admin/reports/${pid}/${action}`, { method: 'POST' })
            .then(r => r.json()).then(d => {
                if (d && d.ok) { el.remove(); toast(action === 'remove' ? 'Post removed.' : 'Post kept.'); }
                else toast((d && d.error) || 'Action failed.');
            }).catch(() => toast('Action failed.'));
    }

    // ── Reported users ─────────────────────────────────────────────────────────
    function loadUsers() {
        usersList.innerHTML = '<div class="admin-empty">Loading…</div>';
        fetch('/pug/api/admin/user-reports').then(r => r.json()).then(rows => {
            if (usersCount) usersCount.textContent = rows.length ? rows.length : '';
            if (!rows.length) { usersList.innerHTML = '<div class="admin-empty">No user reports.</div>'; return; }
            usersList.innerHTML = '';
            rows.forEach(r => {
                const el = document.createElement('div');
                el.className = 'admin-row';
                el.innerHTML = `
                    <div class="admin-row-main">
                        <div class="admin-row-head">
                            <span class="admin-row-author">${esc(r.reported)}</span>
                            <span class="admin-row-badge admin-badge-ctx">${esc(r.context || 'report')}</span>
                            <span class="admin-row-when">${esc(fmtWhen(r.created_at))}</span>
                        </div>
                        <div class="admin-row-text">Reported by <b>${esc(r.reporter)}</b>${r.reason ? ' — ' + esc(r.reason) : ''}</div>
                    </div>
                    <div class="admin-row-actions">
                        <button class="admin-act" data-act="dms">Read DMs</button>
                        <button class="admin-act admin-act-remove" data-act="mute">Mute</button>
                        <button class="admin-act admin-act-keep" data-act="unmute">Unmute</button>
                    </div>`;
                el.querySelector('[data-act="mute"]').onclick   = () => muteUser(r.reported_id, r.reported);
                el.querySelector('[data-act="unmute"]').onclick = () => unmuteUser(r.reported_id, r.reported);
                el.querySelector('[data-act="dms"]').onclick    = () => readDms(r.reported_id, r.reported);
                usersList.appendChild(el);
            });
        }).catch(() => { usersList.innerHTML = '<div class="admin-empty">Failed to load.</div>'; });
    }

    function muteUser(uid, name) {
        fetch(`/pug/api/admin/users/${uid}/mute`, { method: 'POST' })
            .then(r => r.json()).then(d => {
                if (d && d.ok) toast(`${name} muted until ${fmtWhen(d.muted_until)} (strike ${d.violation_count}).`);
                else toast((d && d.error) || 'Mute failed.');
            }).catch(() => toast('Mute failed.'));
    }
    function unmuteUser(uid, name) {
        fetch(`/pug/api/admin/users/${uid}/unmute`, { method: 'POST' })
            .then(r => r.json()).then(d => {
                if (d && d.ok) toast(`${name} unmuted.`);
                else toast((d && d.error) || 'Unmute failed.');
            }).catch(() => toast('Unmute failed.'));
    }
    function readDms(uid, name) {
        fetch(`/pug/api/admin/users/${uid}/dms`).then(r => r.json()).then(d => {
            if (d && d.error) { toast(d.error); return; }
            renderDmModal(uid, name, d);
        }).catch(() => toast('Could not load DMs.'));
    }

    function renderDmModal(uid, name, data) {
        document.querySelector('.admin-dm-overlay')?.remove();
        const threads = (data && data.threads) || [];
        const ov = document.createElement('div');
        ov.className = 'admin-dm-overlay';
        const body = threads.length
            ? threads.map(t => `
                <div class="admin-dm-thread">
                    <div class="admin-dm-with">with ${esc(t.with_username)}</div>
                    ${(t.messages || []).map(m => {
                        const mine = m.from_uid === uid;
                        return `<div class="admin-dm-msg"><b>${esc(mine ? name : t.with_username)}:</b> ${esc(m.text) || '<i>(media)</i>'}</div>`;
                    }).join('')}
                </div>`).join('')
            : '<div class="admin-empty">No DM threads found.</div>';
        ov.innerHTML = `<div class="admin-dm-sheet">
            <div class="admin-dm-head">DMs · ${esc(name)} <button class="icon-btn" id="adminDmClose">✕</button></div>
            <div class="admin-dm-body">${body}</div>
        </div>`;
        document.body.appendChild(ov);
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
        ov.querySelector('#adminDmClose').onclick = () => ov.remove();
    }

    // ── Tabs / nav ─────────────────────────────────────────────────────────────
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const which = tab.getAttribute('data-atab');
            document.getElementById('adminPostsPane').classList.toggle('hidden', which !== 'posts');
            document.getElementById('adminUsersPane').classList.toggle('hidden', which !== 'users');
        });
    });

    function loadAll() { loadPosts(); loadUsers(); }

    openBtn?.addEventListener('click', () => {
        if (window._veyraNavigate) window._veyraNavigate('admin', true);
    });
    refreshBtn?.addEventListener('click', loadAll);

    // Load when the admin tab is opened (and once up front so the counts are warm).
    document.addEventListener('veyra:navigate', e => { if (e.detail && e.detail.route === 'admin') loadAll(); });
    loadAll();
});
