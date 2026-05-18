document.addEventListener('DOMContentLoaded', () => {

    const convList      = document.getElementById('dmConvList');
    const chatView      = document.getElementById('dmChatView');
    const newDmBtn      = document.getElementById('newDmBtn');
    const dmBackBtn     = document.getElementById('dmBackBtn');
    const dmChatName    = document.getElementById('dmChatName');
    const dmMessages    = document.getElementById('dmMessages');
    const dmInput       = document.getElementById('dmInput');
    const dmSendBtn     = document.getElementById('dmSendBtn');
    const newDmModal    = document.getElementById('newDmModal');
    const cancelNewDmBtn= document.getElementById('cancelNewDmBtn');
    const dmUserSearch  = document.getElementById('dmUserSearch');
    const dmUserResults = document.getElementById('dmUserResults');

    let currentOtherId   = null;
    let currentOtherName = '';
    let pollTimer        = null;
    let lastMsgCount     = 0;

    // ── Conversation list ─────────────────────────────────────────────────────
    function loadConvs() {
        fetch('/pug/api/dms')
            .then(r => r.json())
            .then(convs => {
                if (currentOtherId) return; // don't clobber open chat
                convList.innerHTML = '';
                if (!convs.length) {
                    convList.innerHTML = '<div class="dm-empty">No messages yet.<br>Hit <b>+</b> to start a chat.</div>';
                    return;
                }
                convs.forEach(c => {
                    const el = document.createElement('div');
                    el.className = 'dm-conv-item' + (c.unread ? ' dm-unread' : '');
                    el.innerHTML = `
                        <div class="dm-conv-row">
                            <span class="dm-conv-name">${esc(c.username)}</span>
                            ${c.unread ? '<span class="dm-unread-dot"></span>' : ''}
                        </div>
                        <div class="dm-conv-preview">${esc(c.last_msg)}</div>`;
                    el.addEventListener('click', () => openChat(c.other_id, c.username));
                    convList.appendChild(el);
                });
            })
            .catch(() => {});
    }

    // ── Open / close chat ─────────────────────────────────────────────────────
    function openChat(otherId, username) {
        currentOtherId   = otherId;
        currentOtherName = username;
        dmChatName.textContent = username;
        lastMsgCount = 0;
        convList.classList.add('hidden');
        chatView.classList.remove('hidden');
        loadMessages();
        startPolling();
    }

    function closeChat() {
        stopPolling();
        currentOtherId = null;
        chatView.classList.add('hidden');
        convList.classList.remove('hidden');
        loadConvs();
    }

    dmBackBtn?.addEventListener('click', closeChat);

    // ── Messages ──────────────────────────────────────────────────────────────
    function loadMessages() {
        if (!currentOtherId) return;
        fetch(`/pug/api/dms/${currentOtherId}`)
            .then(r => r.json())
            .then(msgs => {
                if (msgs.length === lastMsgCount) return; // nothing new
                lastMsgCount = msgs.length;
                const atBottom = dmMessages.scrollHeight - dmMessages.scrollTop <= dmMessages.clientHeight + 60;
                dmMessages.innerHTML = '';
                msgs.forEach(m => dmMessages.appendChild(makeMsg(m)));
                if (atBottom) dmMessages.scrollTop = dmMessages.scrollHeight;
                // mark read
                fetch(`/pug/api/dms/${currentOtherId}/read`, { method: 'PATCH' }).catch(() => {});
            })
            .catch(() => {});
    }

    function makeMsg(m) {
        const el = document.createElement('div');
        el.className = 'dm-msg ' + (m.is_mine ? 'dm-msg-mine' : 'dm-msg-theirs');
        const time = m.created_at
            ? new Date(m.created_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '';
        el.innerHTML = `<div class="dm-bubble">${esc(m.body)}</div><div class="dm-time">${time}</div>`;
        return el;
    }

    // ── Send ──────────────────────────────────────────────────────────────────
    function sendMsg() {
        const body = dmInput?.value.trim();
        if (!body || !currentOtherId) return;
        dmInput.value = '';
        fetch(`/pug/api/dms/${currentOtherId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body })
        })
        .then(r => r.json())
        .then(m => {
            if (!m.error) {
                lastMsgCount++;
                dmMessages.appendChild(makeMsg({ ...m, is_mine: true }));
                dmMessages.scrollTop = dmMessages.scrollHeight;
            }
        })
        .catch(() => {});
    }

    dmSendBtn?.addEventListener('click', sendMsg);
    dmInput?.addEventListener('keydown', e => { if (e.key === 'Enter') sendMsg(); });

    // ── Polling ───────────────────────────────────────────────────────────────
    function startPolling() {
        stopPolling();
        pollTimer = setInterval(() => {
            if (currentOtherId) loadMessages();
            else loadConvs();
        }, 4000);
    }

    function stopPolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    // ── User search modal ─────────────────────────────────────────────────────
    newDmBtn?.addEventListener('click', () => {
        dmUserSearch.value = '';
        dmUserResults.innerHTML = '';
        newDmModal?.classList.remove('hidden');
        setTimeout(() => dmUserSearch.focus(), 50);
    });

    cancelNewDmBtn?.addEventListener('click', () => newDmModal?.classList.add('hidden'));
    window.addEventListener('click', e => { if (e.target === newDmModal) newDmModal?.classList.add('hidden'); });

    let searchTimer;
    dmUserSearch?.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const q = dmUserSearch.value.trim();
        if (q.length < 2) { dmUserResults.innerHTML = ''; return; }
        searchTimer = setTimeout(() => {
            fetch(`/pug/api/users/search?q=${encodeURIComponent(q)}`)
                .then(r => r.json())
                .then(users => {
                    dmUserResults.innerHTML = '';
                    if (!users.length) {
                        dmUserResults.innerHTML = '<div class="dm-search-empty">No users found.</div>';
                        return;
                    }
                    users.forEach(u => {
                        const el = document.createElement('div');
                        el.className = 'dm-search-result';
                        el.textContent = u.username;
                        el.addEventListener('click', () => {
                            newDmModal?.classList.add('hidden');
                            openChat(u.id, u.username);
                        });
                        dmUserResults.appendChild(el);
                    });
                })
                .catch(() => {});
        }, 300);
    });

    // ── Utils ─────────────────────────────────────────────────────────────────
    function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    loadConvs();
    startPolling();
});
