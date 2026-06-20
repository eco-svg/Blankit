/**
 * dms.js — Direct messages — conversation list, thread view, sending (with media), report/block.
 */

document.addEventListener('DOMContentLoaded', () => {

    // Guests can't use DMs — skip all setup/polling so we don't fire authed 401s.
    if (window.VEYRA_GUEST) return;

    const convList        = document.getElementById('dmConvList');
    const chatView        = document.getElementById('dmChatView');
    const newDmBtn        = document.getElementById('newDmBtn');
    const dmBackBtn       = document.getElementById('dmBackBtn');
    const dmChatName      = document.getElementById('dmChatName');
    const dmMessages      = document.getElementById('dmMessages');
    const dmInput         = document.getElementById('dmInput');
    const dmSendBtn       = document.getElementById('dmSendBtn');
    const cancelNewDmBtn  = document.getElementById('cancelNewDmBtn');
    const dmUserSearch    = document.getElementById('dmUserSearch');
    const dmUserResults   = document.getElementById('dmUserResults');
    const dmCardTitle     = document.getElementById('dmCardTitle');
    const dmChatStatus    = document.getElementById('dmChatStatus');
    const dmAttachBtn     = document.getElementById('dmAttachBtn');
    const dmFileInput     = document.getElementById('dmFileInput');
    const dmMediaPreview  = document.getElementById('dmMediaPreview');
    const dmVoiceBtn      = document.getElementById('dmVoiceBtn');
    const dmVoiceTimer    = document.getElementById('dmVoiceTimer');
    const dmUploadProgress= document.getElementById('dmUploadProgress');
    const dmProgressBar   = document.getElementById('dmProgressBar');

    let currentOtherId   = null;
    let currentOtherName = '';
    let pollTimer        = null;
    let lastMsgCount     = 0;
    let pendingMedia     = null;

    // ── Voice recording ───────────────────────────────────────────────────────
    let mediaRecorder   = null;
    let voiceChunks     = [];
    let voiceClockTimer = null;
    let voiceSeconds    = 0;

    dmVoiceBtn?.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            stopVoiceRecording();
        } else {
            startVoiceRecording();
        }
    });

    async function startVoiceRecording() {
        if (!currentOtherId) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            voiceChunks  = [];
            voiceSeconds = 0;
            if (dmVoiceTimer) { dmVoiceTimer.style.display = 'inline'; dmVoiceTimer.textContent = '0:00'; }

            const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
            mediaRecorder = new MediaRecorder(stream, { mimeType });
            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) voiceChunks.push(e.data); };
            mediaRecorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                const ext  = mimeType.includes('webm') ? 'webm' : 'ogg';
                const blob = new Blob(voiceChunks, { type: mimeType });
                if (blob.size < 500) return;
                uploadAndSendVoice(blob, ext);
            };
            mediaRecorder.start();
            dmVoiceBtn.classList.add('recording');
            dmVoiceBtn.textContent = '⏹';
            voiceClockTimer = setInterval(() => {
                voiceSeconds++;
                if (dmVoiceTimer) dmVoiceTimer.textContent = fmtTime(voiceSeconds);
                if (voiceSeconds >= 120) stopVoiceRecording();
            }, 1000);
        } catch (e) {
            alert('Microphone access is required for voice messages.');
        }
    }

    function stopVoiceRecording() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        mediaRecorder = null;
        clearInterval(voiceClockTimer); voiceClockTimer = null;
        if (dmVoiceBtn) { dmVoiceBtn.classList.remove('recording'); dmVoiceBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>'; }
        if (dmVoiceTimer) { dmVoiceTimer.style.display = 'none'; dmVoiceTimer.textContent = '0:00'; }
    }

    function uploadAndSendVoice(blob, ext) {
        const fd = new FormData();
        fd.append('file', blob, `voice_${Date.now()}.${ext}`);
        fd.append('context', 'dm');                 // keep DM media private to participants
        if (currentOtherId) fd.append('peer', currentOtherId);
        if (dmInput) dmInput.placeholder = 'Sending voice…';
        uploadWithProgress('/pug/api/upload_shared', fd, dmUploadProgress, dmProgressBar)
            .then(data => {
                if (dmInput) dmInput.placeholder = 'Message...';
                if (!data || data.error) return;
                // Auto-send immediately (WhatsApp style)
                fetch(`/pug/api/dms/${currentOtherId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ body: '', media_key: data.key })
                })
                .then(r => r.json())
                .then(m => {
                    if (!m.error) {
                        lastMsgCount++;
                        dmMessages.appendChild(makeMsg({ ...m, is_mine: true, media_url: data.url, media_key: data.key }));
                        dmMessages.scrollTop = dmMessages.scrollHeight;
                    }
                })
                .catch(() => {});
            });
    }

    function fmtTime(s) {
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    function fmtTimeAgo(iso) {
        if (!iso) return '';
        const d = (Date.now() - new Date(iso + 'Z')) / 1000;
        if (d < 60)    return 'now';
        if (d < 3600)  return `${Math.floor(d / 60)}m`;
        if (d < 86400) return `${Math.floor(d / 3600)}h`;
        return `${Math.floor(d / 86400)}d`;
    }

    // ── XHR upload with progress ──────────────────────────────────────────────
    function uploadWithProgress(url, formData, progressEl, barEl) {
        return new Promise(resolve => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url);
            if (progressEl && barEl) {
                progressEl.classList.remove('hidden');
                barEl.style.width = '0%';
            }
            xhr.upload.onprogress = e => {
                if (e.lengthComputable && barEl) {
                    barEl.style.width = `${Math.round(e.loaded / e.total * 100)}%`;
                }
            };
            xhr.onload = () => {
                if (progressEl) progressEl.classList.add('hidden');
                if (barEl) barEl.style.width = '0%';
                try { resolve(JSON.parse(xhr.responseText)); }
                catch (e) { resolve({}); }
            };
            xhr.onerror = () => {
                if (progressEl) progressEl.classList.add('hidden');
                resolve({});
            };
            xhr.send(formData);
        });
    }

    // ── Conversation list ─────────────────────────────────────────────────────
    function loadConvs() {
        fetch('/pug/api/dms')
            .then(r => r.json())
            .then(convs => {
                // always update every DM entry-point badge (header pill + lbar
                // capsule) regardless of which chat is open
                const totalUnread = convs.reduce((s, c) => s + (c.unread_count || 0), 0);
                document.querySelectorAll('.dm-unread-badge').forEach(badge => {
                    if (totalUnread > 0) {
                        badge.textContent = totalUnread > 99 ? '99+' : totalUnread;
                        badge.style.display = '';
                    } else {
                        badge.style.display = 'none';
                    }
                });
                if (currentOtherId) return;
                convList.innerHTML = '';
                if (!convs.length) {
                    convList.innerHTML = '<div class="dm-empty">No messages yet.<br>Hit <b>+</b> to start a chat.</div>';
                    return;
                }
                convs.forEach(c => {
                    const el       = document.createElement('div');
                    el.className   = 'dm-conv-item' + (c.unread ? ' dm-unread' : '');
                    const initials = (c.username || '?')[0].toUpperCase();
                    const timeStr  = c.last_time ? fmtTimeAgo(c.last_time) : '';
                    const cnt      = c.unread_count || 0;
                    el.innerHTML = `
                        <div class="dm-conv-avatar-wrap">
                            <div class="dm-conv-avatar">${initials}</div>
                            <span class="online-dot${c.is_online ? ' is-online' : ''}"></span>
                        </div>
                        <div class="dm-conv-body">
                            <div class="dm-conv-row">
                                <span class="dm-conv-name">${esc(c.username)}</span>
                                <span class="dm-conv-time">${timeStr}</span>
                            </div>
                            <div class="dm-conv-preview">${esc(c.last_msg)}</div>
                        </div>
                        ${cnt > 0 ? `<span class="dm-conv-badge">${cnt > 99 ? '99+' : cnt}</span>` : ''}`;
                    el.addEventListener('click', () => openChat(c.other_id, c.username, c.is_online, c.connections));
                    convList.appendChild(el);
                });
            })
            .catch(() => {});
    }

    // ── Open / close chat ─────────────────────────────────────────────────────
    function openChat(otherId, username, isOnline, connections) {
        currentOtherId   = otherId;
        currentOtherName = username;
        dmChatName.textContent = username;
        if (dmChatStatus) {
            if (isOnline !== undefined) {
                const onlineTxt = isOnline ? '● Online' : '○ Offline';
                const connTxt   = connections !== undefined ? ` · ${connections} connection${connections !== 1 ? 's' : ''}` : '';
                dmChatStatus.textContent = onlineTxt + connTxt;
                dmChatStatus.className   = 'dm-chat-status' + (isOnline ? ' is-online' : '');
            } else {
                dmChatStatus.textContent = '';
                dmChatStatus.className   = 'dm-chat-status';
            }
        }
        lastMsgCount = 0;
        convList.classList.add('hidden');
        chatView.classList.remove('hidden');
        loadMessages();
        startPolling();
    }

    function closeChat() {
        stopPolling();
        stopVoiceRecording();
        currentOtherId = null;
        pendingMedia   = null;
        clearMediaPreview();
        chatView.classList.add('hidden');
        convList.classList.remove('hidden');
        loadConvs();
    }

    // ── Report / block the current conversation partner ────────────────────────
    function dmToast(msg) {
        let t = document.querySelector('.comm-toast');
        if (!t) { t = document.createElement('div'); t.className = 'comm-toast'; document.body.appendChild(t); }
        t.textContent = msg;
        requestAnimationFrame(() => t.classList.add('show'));
        clearTimeout(t._h);
        t._h = setTimeout(() => t.classList.remove('show'), 2800);
    }
    function dmModSheet(innerHtml) {
        document.querySelector('.comm-mod-overlay')?.remove();
        const ov = document.createElement('div');
        ov.className = 'comm-mod-overlay';
        ov.innerHTML = `<div class="comm-mod-sheet">${innerHtml}</div>`;
        document.body.appendChild(ov);
        ov.addEventListener('click', ev => { if (ev.target === ov) ov.remove(); });
        return ov;
    }
    const DM_REPORT_REASONS = ['Nudity or sexual content', 'Harassment or hate', 'Spam or scam', 'Threats or violence', 'Other'];

    const dmReportBtn = document.getElementById('dmReportBtn');
    if (dmReportBtn) {
        dmReportBtn.addEventListener('click', () => {
            if (!currentOtherId) return;
            const uid = currentOtherId;
            const ov = dmModSheet(`
                <div class="comm-mod-title">Report ${currentOtherName || 'this user'}</div>
                <div class="comm-mod-sub">Private messages aren't monitored, but we review reports.</div>
                ${DM_REPORT_REASONS.map(r => `<button class="comm-mod-item" data-r="${r}">${r}</button>`).join('')}
                <button class="comm-mod-item comm-mod-cancel" data-r="">Cancel</button>`);
            ov.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
                const reason = b.dataset.r; ov.remove();
                if (!reason) return;
                fetch(`/pug/api/dms/${uid}/report`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reason })
                }).then(r => r.json())
                  .then(() => dmToast('Reported. Thanks — we’ll review it.'))
                  .catch(() => dmToast('Could not send report.'));
            });
        });
    }

    const dmBlockBtn = document.getElementById('dmBlockBtn');
    if (dmBlockBtn) {
        dmBlockBtn.addEventListener('click', () => {
            if (!currentOtherId) return;
            const uid = currentOtherId;
            const ov = dmModSheet(`
                <div class="comm-mod-title">Block ${currentOtherName || 'this user'}?</div>
                <div class="comm-mod-sub">Neither of you will be able to message the other, and you won't see their posts.</div>
                <button class="comm-mod-item comm-mod-danger" data-act="ok">Block</button>
                <button class="comm-mod-item comm-mod-cancel" data-act="no">Cancel</button>`);
            ov.querySelector('[data-act="no"]').onclick = () => ov.remove();
            ov.querySelector('[data-act="ok"]').onclick = () => {
                ov.remove();
                fetch(`/pug/api/users/${uid}/block`, { method: 'POST' })
                    .then(r => r.json())
                    .then(() => { dmToast('User blocked.'); closeChat(); })
                    .catch(() => dmToast('Could not block user.'));
            };
        });
    }

    dmBackBtn?.addEventListener('click', closeChat);

    // ── Messages ──────────────────────────────────────────────────────────────
    function loadMessages() {
        if (!currentOtherId) return;
        fetch(`/pug/api/dms/${currentOtherId}`)
            .then(r => r.json())
            .then(msgs => {
                if (msgs.length === lastMsgCount) return;
                lastMsgCount = msgs.length;
                const atBottom = dmMessages.scrollHeight - dmMessages.scrollTop <= dmMessages.clientHeight + 60;
                dmMessages.innerHTML = '';
                msgs.forEach(m => dmMessages.appendChild(makeMsg(m)));
                if (atBottom) dmMessages.scrollTop = dmMessages.scrollHeight;
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

        let mediaHtml = '';
        if (m.media_url) {
            const ext = (m.media_key || '').split('.').pop().toLowerCase();
            if (['mp3','wav','ogg','m4a','flac','webm'].includes(ext) || m.type === 'audio') {
                mediaHtml = `<audio class="dm-bubble-audio" controls src="${m.media_url}"></audio>`;
            } else if (['mp4'].includes(ext)) {
                mediaHtml = `<video class="dm-bubble-video" controls src="${m.media_url}" playsinline></video>`;
            } else {
                mediaHtml = `<img class="dm-bubble-img" src="${m.media_url}" loading="lazy">`;
            }
        }

        let bodyHtml = '';
        if (m.body) {
            const qMatch = m.body.match(/^§§POST§§([\s\S]*?)§§END§§\n?([\s\S]*)$/);
            const nMatch = m.body.match(/^§§NOTIF§§([\s\S]*?)§§END§§\n?([\s\S]*)$/);
            if (qMatch) {
                const quoteText = esc(qMatch[1].trim());
                const msgText   = esc(qMatch[2].trim());
                bodyHtml = `<div class="dm-bubble"><div class="dm-post-quote"><span class="dm-post-quote-label">Post</span>${quoteText}</div>${msgText}</div>`;
            } else if (nMatch) {
                const notifCtx  = esc(nMatch[1].trim());
                const notifText = esc(nMatch[2].trim());
                bodyHtml = `<div class="dm-bubble dm-notif-bubble"><span class="dm-notif-label">💬 Comment reply</span><div class="dm-notif-ctx">${notifCtx}</div>${notifText}</div>`;
            } else {
                bodyHtml = `<div class="dm-bubble">${esc(m.body)}</div>`;
            }
        }
        el.innerHTML = `${mediaHtml}${bodyHtml}<div class="dm-time">${time}</div>`;
        return el;
    }

    // ── Send text/file message ────────────────────────────────────────────────
    let mktNext = false;   // next send is a marketplace (Hire/Buy/Collab) contact

    function sendMsg() {
        const body = dmInput?.value.trim();
        if (!body && !pendingMedia) return;
        if (!currentOtherId) return;
        const mediaKey = pendingMedia?.key || '';
        const savedBody = body;
        const mkt = mktNext; mktNext = false;   // consume the one-shot flag
        dmInput.value = '';
        clearMediaPreview();
        pendingMedia = null;

        fetch(`/pug/api/dms/${currentOtherId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body, media_key: mediaKey, mkt })
        })
        .then(r => r.json())
        .then(m => {
            if (m.error) {
                if (dmInput) dmInput.value = savedBody;
                dmToast(m.error);   // e.g. minor-protection / muted / blocked
            } else {
                lastMsgCount++;
                dmMessages.appendChild(makeMsg({ ...m, is_mine: true }));
                dmMessages.scrollTop = dmMessages.scrollHeight;
            }
        })
        .catch(() => {
            if (dmInput) dmInput.value = savedBody;
        });
    }

    dmSendBtn?.addEventListener('click', sendMsg);
    dmInput?.addEventListener('keydown', e => { if (e.key === 'Enter') sendMsg(); });

    // ── Media attach ──────────────────────────────────────────────────────────
    dmAttachBtn?.addEventListener('click', () => dmFileInput?.click());

    dmFileInput?.addEventListener('change', () => {
        const file = dmFileInput.files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('file', file);
        fd.append('context', 'dm');                 // keep DM media private to participants
        if (currentOtherId) fd.append('peer', currentOtherId);
        uploadWithProgress('/pug/api/upload_shared', fd, dmUploadProgress, dmProgressBar)
            .then(data => {
                if (!data || data.error) return;
                pendingMedia = data;
                renderMediaPreview(dmMediaPreview, data);
            });
        dmFileInput.value = '';
    });

    function renderMediaPreview(container, media) {
        if (!container) return;
        container.classList.remove('hidden');
        container.innerHTML = '';
        let el;
        if (media.type === 'image') {
            el = document.createElement('img');
            el.src = media.url;
            el.className = 'dm-media-preview-img';
        } else if (media.type === 'video') {
            el = document.createElement('video');
            el.src = media.url;
            el.controls = true;
            el.className = 'dm-media-preview-video';
        } else {
            el = document.createElement('audio');
            el.src = media.url;
            el.controls = true;
            el.className = 'dm-media-preview-audio';
        }
        const removeBtn = document.createElement('button');
        removeBtn.className = 'dm-media-remove';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => {
            pendingMedia = null;
            clearMediaPreview();
        });
        const wrap = document.createElement('div');
        wrap.className = 'dm-media-preview-wrap';
        wrap.appendChild(el);
        wrap.appendChild(removeBtn);
        container.appendChild(wrap);
    }

    function clearMediaPreview() {
        if (!dmMediaPreview) return;
        dmMediaPreview.innerHTML = '';
        dmMediaPreview.classList.add('hidden');
    }

    // ── Polling ───────────────────────────────────────────────────────────────
    // Near-realtime: every 2s hit the tiny version endpoint and only re-fetch
    // messages/conversations when something actually changed.
    let dmVersion = null;
    function checkDmVersion() {
        if (document.hidden) return;
        fetch('/pug/api/dms/version')
            .then(r => r.json())
            .then(d => {
                if (typeof d.v === 'undefined') return;
                if (dmVersion !== null && d.v !== dmVersion) {
                    if (currentOtherId) loadMessages();
                    loadConvs(); // refreshes the list and the header unread badge
                }
                dmVersion = d.v;
            }).catch(() => {});
    }

    function startPolling() {
        stopPolling();
        checkDmVersion();
        pollTimer = setInterval(checkDmVersion, 2000);
    }

    function stopPolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    // ── User search (inline in DM card header) ────────────────────────────────
    function openDmSearch() {
        dmCardTitle?.classList.add('hidden');
        dmUserSearch?.classList.remove('hidden');
        cancelNewDmBtn && (cancelNewDmBtn.style.display = '');
        newDmBtn && (newDmBtn.style.display = 'none');
        dmUserSearch.value = '';
        dmUserResults.innerHTML = '';
        dmUserResults?.classList.add('hidden');
        setTimeout(() => dmUserSearch?.focus(), 50);
    }

    function closeDmSearch() {
        dmCardTitle?.classList.remove('hidden');
        dmUserSearch?.classList.add('hidden');
        cancelNewDmBtn && (cancelNewDmBtn.style.display = 'none');
        newDmBtn && (newDmBtn.style.display = '');
        dmUserResults?.classList.add('hidden');
        dmUserResults.innerHTML = '';
    }

    newDmBtn?.addEventListener('click', openDmSearch);
    cancelNewDmBtn?.addEventListener('click', closeDmSearch);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDmSearch(); });

    let searchTimer;
    dmUserSearch?.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const q = dmUserSearch.value.trim();
        if (q.length < 2) { dmUserResults.innerHTML = ''; dmUserResults?.classList.add('hidden'); return; }
        searchTimer = setTimeout(() => {
            fetch(`/pug/api/users/search?q=${encodeURIComponent(q)}`)
                .then(r => r.ok ? r.json() : r.json().then(e => { throw e; }))
                .then(users => {
                    dmUserResults.innerHTML = '';
                    dmUserResults?.classList.remove('hidden');
                    if (!Array.isArray(users) || !users.length) {
                        dmUserResults.innerHTML = '<div class="dm-search-empty">No users found.</div>';
                        return;
                    }
                    users.forEach(u => {
                        const el = document.createElement('div');
                        el.className = 'dm-search-result';
                        el.textContent = u.username;
                        el.addEventListener('click', () => {
                            closeDmSearch();
                            openChat(u.id, u.username);
                        });
                        dmUserResults.appendChild(el);
                    });
                })
                .catch(() => { dmUserResults.innerHTML = '<div class="dm-search-empty">No users found.</div>'; dmUserResults?.classList.remove('hidden'); });
        }, 300);
    });

    // ── Utils ─────────────────────────────────────────────────────────────────
    function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Cross-module DM open (from community marketplace CTAs) ────────────────
    document.addEventListener('veyra:open-dm', e => {
        // The DM card lives on the Notes tab — bring that tab up, then scroll the
        // card into view, before opening the chat.
        if (window._veyraNavigate) window._veyraNavigate('notes', true);
        setTimeout(() => document.getElementById('sec-dms')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
        openChat(e.detail.uid, e.detail.username);
        const msg = e.detail.autoMessage;
        if (msg) {
            // wait for chat to open + messages to load, then auto-send. This is a
            // marketplace contact (Hire/Buy/Collab) → flagged mkt so it's allowed to
            // reach a minor (general adult→minor DMs are blocked server-side).
            setTimeout(() => {
                if (dmInput) dmInput.value = msg;
                mktNext = true;
                sendMsg();
            }, 600);
        }
    });

    // ── Init ──────────────────────────────────────────────────────────────────
    loadConvs();
    startPolling();
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) checkDmVersion();
    });
});
