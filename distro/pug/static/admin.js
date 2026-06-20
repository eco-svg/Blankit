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
    const eyesList    = document.getElementById('adminEyesList');
    const membersList = document.getElementById('adminMembersList');
    const postsCount  = document.getElementById('adminPostsCount');
    const usersCount  = document.getElementById('adminUsersCount');
    const eyesCount   = document.getElementById('adminEyesCount');
    const membersCount= document.getElementById('adminMembersCount');
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
        const noteHtml = data && data.note ? `<div class="admin-dm-note">${esc(data.note)}</div>` : '';
        const body = threads.length
            ? threads.map(t => `
                <div class="admin-dm-thread">
                    <div class="admin-dm-with">with ${esc(t.with_username)}${t.reported_at ? ` · reported ${esc(new Date(t.reported_at).toLocaleString())}` : ''}</div>
                    ${(t.messages || []).map(m => {
                        const mine = m.from_uid === uid;
                        return `<div class="admin-dm-msg"><b>${esc(mine ? name : t.with_username)}:</b> ${esc(m.text) || '<i>(media)</i>'}</div>`;
                    }).join('')}
                </div>`).join('')
            : '<div class="admin-empty">No DM threads found.</div>';
        ov.innerHTML = `<div class="admin-dm-sheet">
            <div class="admin-dm-head">DMs · ${esc(name)} <button class="icon-btn" id="adminDmClose">✕</button></div>
            <div class="admin-dm-body">${noteHtml}${body}</div>
        </div>`;
        document.body.appendChild(ov);
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
        ov.querySelector('#adminDmClose').onclick = () => ov.remove();
    }

    // ── Eyes top-up requests ───────────────────────────────────────────────────
    function loadEyes() {
        if (!eyesList) return;
        eyesList.innerHTML = '<div class="admin-empty">Loading…</div>';
        fetch('/pug/api/admin/eyes-requests').then(r => r.json()).then(rows => {
            if (eyesCount) eyesCount.textContent = rows.length ? rows.length : '';
            if (!rows.length) { eyesList.innerHTML = '<div class="admin-empty">No pending Eyes requests.</div>'; return; }
            eyesList.innerHTML = '';
            rows.forEach(t => {
                const el = document.createElement('div');
                el.className = 'admin-row';
                el.innerHTML = `
                    <div class="admin-row-main">
                        <div class="admin-row-head">
                            <span class="admin-row-author">${esc(t.user)}</span>
                            <span class="admin-row-badge admin-badge-ctx">${esc(t.amount)} Eyes · ${esc(t.currency)}</span>
                            <span class="admin-row-when">${esc(fmtWhen(t.created_at))}</span>
                        </div>
                        <div class="admin-row-text">Wants to top up — confirm their payment, then fulfil to credit the Eyes.</div>
                    </div>
                    <div class="admin-row-actions">
                        <button class="admin-act admin-act-keep" data-act="fulfill">Fulfil</button>
                        <button class="admin-act admin-act-remove" data-act="dismiss">Dismiss</button>
                    </div>`;
                el.querySelector('[data-act="fulfill"]').onclick = () => {
                    if (confirm(`Credit ${t.amount} Eyes to ${t.user}? Do this only after their payment is confirmed.`)) eyesAction(t.id, 'fulfill', el);
                };
                el.querySelector('[data-act="dismiss"]').onclick = () => eyesAction(t.id, 'dismiss', el);
                eyesList.appendChild(el);
            });
        }).catch(() => { eyesList.innerHTML = '<div class="admin-empty">Failed to load.</div>'; });
    }
    function eyesAction(txId, action, el) {
        fetch(`/pug/api/admin/eyes-requests/${txId}/${action}`, { method: 'POST' })
            .then(r => r.json()).then(d => {
                if (d && d.ok) { el.remove(); toast(action === 'fulfill' ? 'Eyes credited.' : 'Request dismissed.'); loadEyes(); }
                else toast((d && d.error) || 'Action failed.');
            }).catch(() => toast('Action failed.'));
    }

    // ── Members overview (distro headcount + recent sign-ups) ──────────────────
    function loadMembers() {
        if (!membersList) return;
        membersList.innerHTML = '<div class="admin-empty">Loading…</div>';
        fetch('/pug/api/admin/users-overview').then(r => r.json()).then(d => {
            // Viewing the members list = acknowledging current sign-ups → clears the
            // "new signup" part of the live header bell.
            if (d.total != null) { localStorage.setItem('veyra-admin-seen-users', String(d.total)); refreshBell(); }
            if (membersCount) membersCount.textContent = d.new_24h ? d.new_24h : '';
            const stats = document.getElementById('adminMembersStats');
            if (stats) stats.innerHTML =
                `<div class="admin-stat"><div class="admin-stat-num">${d.total}</div><div class="admin-stat-lbl">Total</div></div>` +
                `<div class="admin-stat"><div class="admin-stat-num admin-stat-on">${d.online}</div><div class="admin-stat-lbl">Online now</div></div>` +
                `<div class="admin-stat"><div class="admin-stat-num">${d.new_24h}</div><div class="admin-stat-lbl">New · 24h</div></div>`;
            const recent = d.recent || [];
            if (!recent.length) { membersList.innerHTML = '<div class="admin-empty">No members yet.</div>'; return; }
            membersList.innerHTML = '';
            recent.forEach(u => {
                const el = document.createElement('div');
                el.className = 'admin-row';
                el.innerHTML = `
                    <div class="admin-row-main">
                        <div class="admin-row-head">
                            <span class="online-dot${u.online ? ' is-online' : ''}"></span>
                            <span class="admin-row-author">${esc(u.username)}</span>
                            <span class="admin-row-when">${esc(fmtWhen(u.created_at))}</span>
                        </div>
                    </div>`;
                membersList.appendChild(el);
            });
        }).catch(() => { membersList.innerHTML = '<div class="admin-empty">Failed to load.</div>'; });
    }

    function loadVisits() {
        const chart = document.getElementById('adminVisitsChart');
        const stats = document.getElementById('adminVisitsStats');
        if (!chart || !stats) return;
        chart.innerHTML = '<div class="admin-empty">Loading…</div>';
        fetch('/pug/api/admin/visits').then(r => r.json()).then(d => {
            if (d && d.error) { chart.innerHTML = `<div class="admin-empty">${esc(d.error)}</div>`; return; }
            const sub = (ex, ap) => `<div class="admin-stat-sub">${ex} exact · ${ap} approx</div>`;
            stats.innerHTML =
                `<div class="admin-stat"><div class="admin-stat-num">${d.views_today}</div><div class="admin-stat-lbl">Views · today</div></div>` +
                `<div class="admin-stat"><div class="admin-stat-num admin-stat-on">${d.unique_today}</div><div class="admin-stat-lbl">Visits · today</div>${sub(d.exact_today||0, d.approx_today||0)}</div>` +
                `<div class="admin-stat"><div class="admin-stat-num">${d.unique_alltime}</div><div class="admin-stat-lbl">Visits · all-time</div>${sub(d.exact_alltime||0, d.approx_alltime||0)}</div>`;
            const series = d.days || [];
            const max = Math.max(1, ...series.map(s => s.views));
            chart.innerHTML = series.map(s => {
                const h = Math.round((s.views / max) * 100);
                const lbl = (s.day || '').slice(5);   // MM-DD
                return `<div class="admin-bar-col" title="${esc(s.day)} · ${s.views} views, ${s.uniques} visitors">
                    <div class="admin-bar-val">${s.views || ''}</div>
                    <div class="admin-bar" style="height:${h}%"></div>
                    <div class="admin-bar-lbl">${esc(lbl)}</div>
                </div>`;
            }).join('') || '<div class="admin-empty">No visits recorded yet.</div>';
        }).catch(() => { chart.innerHTML = '<div class="admin-empty">Failed to load.</div>'; });
    }

    // ── Tabs / nav (moderation queues only; Members + Visits live in the Overview card) ──
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const which = tab.getAttribute('data-atab');
            document.getElementById('adminPostsPane').classList.toggle('hidden', which !== 'posts');
            document.getElementById('adminUsersPane').classList.toggle('hidden', which !== 'users');
            document.getElementById('adminEyesPane').classList.toggle('hidden', which !== 'eyes');
        });
    });

    // Overview card flip — front = stats, back = views graph.
    const ovFlipBtn = document.getElementById('ovFlipBtn');
    const ovFlipInner = document.getElementById('ovFlipInner');
    const ovTitle = document.getElementById('ovTitle');
    ovFlipBtn?.addEventListener('click', () => {
        const flipped = ovFlipInner.classList.toggle('flipped');
        ovFlipBtn.title = flipped ? 'Show overview' : 'Show views graph';
        if (ovTitle) ovTitle.textContent = flipped ? 'Views' : 'Overview';
    });

    // Reset visit stats (clears the counter tables).
    document.getElementById('adminVisitsReset')?.addEventListener('click', () => {
        if (!confirm('Clear all visit data? This cannot be undone.')) return;
        fetch('/pug/api/admin/visits/reset', { method: 'POST' })
            .then(r => r.json())
            .then(d => { if (d && d.ok) { toast('Visit data cleared.'); loadVisits(); } else toast((d && d.error) || 'Reset failed.'); })
            .catch(() => toast('Reset failed.'));
    });

    // Members + Visits are always shown in the Overview card (no tab gating).
    function loadAll() { loadPosts(); loadUsers(); loadEyes(); loadMembers(); loadVisits(); }

    // ── Live header bell — polls for new sign-ups + pending actions, lights the bell
    //    in the header even when the admin isn't on the panel. ──────────────────────
    const bell      = document.getElementById('adminBell');
    const bellBadge = document.getElementById('adminBellBadge');
    let lastNotif   = null;
    function refreshBell() {
        if (!bell || !bellBadge || !lastNotif) return;
        const seen = parseInt(localStorage.getItem('veyra-admin-seen-users') || '', 10);
        const base = isNaN(seen) ? lastNotif.users : seen;
        const newSignups = Math.max(0, (lastNotif.users || 0) - base);
        const pending    = (lastNotif.eyes || 0) + (lastNotif.posts || 0) + (lastNotif.user_reports || 0);
        const total      = newSignups + pending;
        bellBadge.textContent = total > 99 ? '99+' : total;
        bell.classList.toggle('has-notif', total > 0);
    }
    function pollBell() {
        fetch('/pug/api/admin/notif').then(r => r.json()).then(d => {
            if (!d || d.users == null) return;
            // First ever poll: baseline the signup count so existing users don't all
            // read as "new".
            if (localStorage.getItem('veyra-admin-seen-users') == null) {
                localStorage.setItem('veyra-admin-seen-users', String(d.users));
            }
            lastNotif = d;
            refreshBell();
        }).catch(() => {});
    }
    if (bell) {
        bell.addEventListener('click', () => { if (window._veyraNavigate) window._veyraNavigate('admin', true); });
        pollBell();
        setInterval(pollBell, 40000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) pollBell(); });
    }

    openBtn?.addEventListener('click', () => {
        if (window._veyraNavigate) window._veyraNavigate('admin', true);
    });
    refreshBtn?.addEventListener('click', loadAll);

    // Load when the admin tab is opened (and once up front so the counts are warm).
    document.addEventListener('veyra:navigate', e => { if (e.detail && e.detail.route === 'admin') loadAll(); });
    loadAll();
});
