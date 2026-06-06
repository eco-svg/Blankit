document.addEventListener('DOMContentLoaded', () => {

    const feed            = document.getElementById('commFeed');
    const composeBtn      = document.getElementById('commComposeBtn');
    const cancelPostBtn   = document.getElementById('cancelCommPostBtn');
    const confirmPostBtn  = document.getElementById('confirmCommPostBtn');
    const commTitleBlock  = document.getElementById('commTitleBlock');
    const inlineCompose   = document.getElementById('commInlineCompose');
    const modalError      = document.getElementById('commModalError');
    const rangeLabel      = document.getElementById('commRangeLabel');

    // Write tab
    const tabWrite        = document.getElementById('commTabWrite');
    const tabQuick        = document.getElementById('commTabQuick');
    const writePane       = document.getElementById('commWritePane');
    const quickPane       = document.getElementById('commQuickPane');
    const modalInput      = document.getElementById('commModalInput');
    const modalCharCount  = document.getElementById('commModalCharCount');
    const fileInput       = document.getElementById('commFileInput');
    const mediaPreview    = document.getElementById('commModalMediaPreview');
    const uploadProgress  = document.getElementById('commUploadProgress');
    const progressBar     = document.getElementById('commProgressBar');

    // Quick tab
    const quickZone       = document.getElementById('commQuickZone');
    const quickFileInput  = document.getElementById('commQuickFileInput');
    const quickPlaceholder= document.getElementById('commQuickPlaceholder');
    const quickPreview    = document.getElementById('commQuickPreview');
    const quickProgress   = document.getElementById('commQuickProgress');
    const quickProgressBar= document.getElementById('commQuickProgressBar');
    const quickCaption    = document.getElementById('commQuickCaption');
    const quickCaptionCount = document.getElementById('commQuickCaptionCount');

    const MAX_LEN = 500;
    let lastPostCount  = 0;
    let posting        = false;
    let pendingMedia   = null;
    let pendingQuick   = null;
    let activeTab      = 'write';
    let myLat = null, myLng = null;
    let activeSkill    = '';
    let activePostType = null;
    let feedMode       = localStorage.getItem('veyra-comm-mode') || 'radar';

    // ── Feed mode toggle ───────────────────────────────────────────────────────
    document.querySelectorAll('.comm-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === feedMode);
        btn.addEventListener('click', () => {
            feedMode = btn.dataset.mode;
            localStorage.setItem('veyra-comm-mode', feedMode);
            document.querySelectorAll('.comm-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === feedMode));
            lastPostCount = 0;
            loadFeed();
        });
    });

    // ── Post type pills ────────────────────────────────────────────────────────
    document.querySelectorAll('.comm-type-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            const t = pill.dataset.type;
            if (activePostType === t) {
                activePostType = null;
                pill.classList.remove('active');
            } else {
                document.querySelectorAll('.comm-type-pill').forEach(p => p.classList.remove('active'));
                activePostType = t;
                pill.classList.add('active');
            }
        });
    });

    // ── Skill filter chips ──────────────────────────────────────────────────────
    document.querySelectorAll('.comm-skill-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.comm-skill-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeSkill = chip.dataset.skill || '';
            lastPostCount = 0;
            loadFeed();
        });
    });

    // ── Geolocation ────────────────────────────────────────────────────────────
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            myLat = pos.coords.latitude;
            myLng = pos.coords.longitude;
            fetch('/pug/api/location', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lat: myLat, lng: myLng })
            }).catch(() => {});
            lastPostCount = 0;
            loadFeed();
        }, () => {}, { timeout: 5000 });
    }

    // ── Feed ───────────────────────────────────────────────────────────────────
    function loadFeed() {
        let url = '/pug/api/community';
        const params = [];
        if (feedMode === 'radar' && myLat !== null && myLng !== null) {
            params.push(`lat=${myLat}`);
            params.push(`lng=${myLng}`);
        }
        if (activeSkill) params.push(`skill=${encodeURIComponent(activeSkill)}`);
        if (params.length) url += '?' + params.join('&');
        fetch(url)
            .then(r => r.json())
            .then(data => {
                const posts  = Array.isArray(data) ? data : (data.posts || []);
                const radius = Array.isArray(data) ? null : data.radius_km;
                if (rangeLabel) {
                    if (feedMode === 'global') {
                        rangeLabel.textContent = '🌐 global feed';
                    } else if (radius) {
                        rangeLabel.textContent = `📍 within ${radius} km`;
                    } else {
                        rangeLabel.textContent = '📍 radar';
                    }
                }
                if (posts.length === lastPostCount) return;
                lastPostCount = posts.length;
                feed.innerHTML = '';
                if (!posts.length) {
                    feed.innerHTML = '<div class="comm-empty">No posts yet. Be the first.</div>';
                    return;
                }
                posts.forEach(p => feed.appendChild(makePost(p)));
            })
            .catch(() => {});
    }


    function makePost(p) {
        const el       = document.createElement('div');
        el.className   = 'comm-post';
        el.dataset.id  = p.id;
        const initials = (p.username || '?')[0].toUpperCase();
        const ago      = timeAgo(p.created_at);
        const rankHtml = p.rank
            ? `<span class="comm-rank-badge" style="color:${p.rank_color};">${p.rank}</span>` : '';
        const deleteBtn = p.is_mine
            ? `<button class="comm-del-btn" data-id="${p.id}" title="Delete">×</button>` : '';

        let mediaHtml = '';
        if (p.media_url) {
            const ext = (p.media_key || '').split('.').pop().toLowerCase();
            if (['mp3','wav','ogg','m4a','flac'].includes(ext))
                mediaHtml = `<audio class="comm-media-audio" controls src="${p.media_url}"></audio>`;
            else if (['mp4','webm'].includes(ext))
                mediaHtml = `<video class="comm-media-video" controls src="${p.media_url}" playsinline></video>`;
            else
                mediaHtml = `<img class="comm-media-img" src="${p.media_url}" loading="lazy">`;
        }

        const usernameHtml = p.is_mine
            ? `<span class="comm-username">${esc(p.username)}</span>`
            : `<button class="comm-username comm-username-link" data-uid="${p.user_id}">${esc(p.username)}</button>`;

        const isShowOff = p.post_type === 'showoff';
        const mine      = p.is_mine ? '1' : '';
        const uid_      = p.user_id;
        const uname_    = esc(p.username);

        const likeActive    = p.my_reaction === 'like'    ? ' active' : '';
        const dislikeActive = p.my_reaction === 'dislike' ? ' active' : '';

        // Buy + Learn only on ShowOff posts (bottom right)
        const showOffBtns = isShowOff ? `
            <button class="comm-action-btn comm-action-buy"   data-uid="${uid_}" data-username="${uname_}" data-mine="${mine}">Buy</button>
            <button class="comm-action-btn comm-action-learn" data-uid="${uid_}" data-username="${uname_}" data-mine="${mine}">Learn</button>` : '';

        const typeSwitcher = p.is_mine ? `
            <div class="comm-type-switcher">
                <button class="comm-type-sw-btn${!isShowOff ? ' active' : ''}" data-type="blog">Blog</button>
                <button class="comm-type-sw-btn${isShowOff ? ' active' : ''}" data-type="showoff">ShowOff ✦</button>
            </div>` : '';

        el.innerHTML = `
            <div class="comm-post-header">
                <div class="comm-avatar">${initials}</div>
                <div class="comm-meta">
                    ${usernameHtml}
                    ${rankHtml}
                    <span class="comm-distro-tag">${esc(p.distro)}</span>
                </div>
                <div style="display:flex;align-items:center;gap:6px;margin-left:auto;">
                    <span class="comm-ago">${ago}</span>
                    ${deleteBtn}
                </div>
            </div>
            ${mediaHtml}
            ${p.text ? `<div class="comm-post-body">${esc(p.text)}</div>` : ''}
            ${typeSwitcher}
            <div class="comm-post-footer">
                <div class="comm-showoff-btns">${showOffBtns}</div>
                <div class="comm-post-reactions">
                    <button class="comm-react-btn${likeActive}" data-action="like">👍 <span class="react-count">${p.likes||0}</span></button>
                    <button class="comm-react-btn${dislikeActive}" data-action="dislike">👎 <span class="react-count">${p.dislikes||0}</span></button>
                    <button class="comm-react-btn" data-action="comment">💬 <span class="react-count">${p.comment_count||0}</span></button>
                    <button class="comm-react-btn comm-share-btn" data-action="share">↗</button>
                </div>
            </div>
            <div class="comm-comments-preview"></div>
            <div class="comm-post-comments hidden">
                <div class="comm-comments-list"></div>
                <div class="comm-comment-input-row">
                    <input type="text" class="comm-comment-input" placeholder="Add a comment..." maxlength="300" autocomplete="off">
                    <button class="comm-comment-send">→</button>
                </div>
            </div>`;

        el.querySelector('.comm-del-btn')?.addEventListener('click', () => deletePost(p.id));
        el.querySelector('.comm-username-link')?.addEventListener('click', () => openProfile(p.user_id, p.username));

        // Buy / Learn buttons — open DM
        el.querySelectorAll('.comm-action-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                if (this.dataset.mine) return;
                const uid      = parseInt(this.dataset.uid);
                const username = this.dataset.username;
                document.getElementById('commDmLbar')?.classList.add('open');
                document.dispatchEvent(new CustomEvent('veyra:open-dm', { detail: { uid, username } }));
            });
        });

        // Type switcher (own posts)
        el.querySelectorAll('.comm-type-sw-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const newType = this.dataset.type;
                fetch(`/pug/api/community/${p.id}/type`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ post_type: newType })
                }).then(r => r.json()).then(data => {
                    if (!data.ok) return;
                    el.querySelectorAll('.comm-type-sw-btn').forEach(b =>
                        b.classList.toggle('active', b.dataset.type === newType));
                    const nowShowOff = newType === 'showoff';
                    const showOffContainer = el.querySelector('.comm-showoff-btns');
                    if (showOffContainer) {
                        showOffContainer.innerHTML = nowShowOff ? `
                            <button class="comm-action-btn comm-action-buy"   data-uid="${uid_}" data-username="${uname_}" data-mine="${mine}">Buy</button>
                            <button class="comm-action-btn comm-action-learn" data-uid="${uid_}" data-username="${uname_}" data-mine="${mine}">Learn</button>` : '';
                        showOffContainer.querySelectorAll('.comm-action-btn').forEach(b => {
                            b.addEventListener('click', function() {
                                if (this.dataset.mine) return;
                                document.getElementById('commDmLbar')?.classList.add('open');
                                document.dispatchEvent(new CustomEvent('veyra:open-dm', { detail: { uid: parseInt(this.dataset.uid), username: this.dataset.username } }));
                            });
                        });
                    }
                }).catch(() => {});
            });
        });

        // Reactions
        el.querySelectorAll('.comm-react-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                if (action === 'share') {
                    navigator.clipboard?.writeText(p.text || location.href).catch(() => {});
                    btn.textContent = '✓';
                    setTimeout(() => { btn.textContent = '↗'; }, 1500);
                    return;
                }
                if (action === 'comment') {
                    const preview    = el.querySelector('.comm-comments-preview');
                    const commentsEl = el.querySelector('.comm-post-comments');
                    preview?.classList.add('hidden');
                    const nowVisible = commentsEl.classList.toggle('hidden') === false;
                    if (nowVisible && commentsEl.dataset.loaded !== 'true') {
                        loadComments(p.id, commentsEl, p.is_mine);
                    }
                    return;
                }
                fetch(`/pug/api/community/${p.id}/react`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: action })
                }).then(r => r.json()).then(data => {
                    el.querySelector('[data-action="like"] .react-count').textContent    = data.likes    || 0;
                    el.querySelector('[data-action="dislike"] .react-count').textContent = data.dislikes || 0;
                    el.querySelector('[data-action="like"]').classList.toggle('active',    data.my_reaction === 'like');
                    el.querySelector('[data-action="dislike"]').classList.toggle('active', data.my_reaction === 'dislike');
                }).catch(() => {});
            });
        });

        // Comments
        const commentsEl   = el.querySelector('.comm-post-comments');
        const commentInput = el.querySelector('.comm-comment-input');
        const commentSend  = el.querySelector('.comm-comment-send');
        commentSend?.addEventListener('click', () => sendComment(p.id, commentInput, commentsEl, el));
        commentInput?.addEventListener('keydown', e => { if (e.key === 'Enter') sendComment(p.id, commentInput, commentsEl, el); });

        // Auto-load top 3 preview comments
        if ((p.comment_count || 0) > 0) {
            loadPreviewComments(p.id, el);
        }

        return el;
    }

    function buildCommentRow(c, isMine) {
        const pinBtn = c.can_pin
            ? `<button class="comm-pin-btn${c.is_pinned ? ' pinned' : ''}" data-cid="${c.id}" title="${c.is_pinned ? 'Unpin' : 'Pin'}">📌</button>` : '';
        const pinBadge = c.is_pinned ? `<span class="comm-pin-badge">pinned</span>` : '';
        const row = document.createElement('div');
        row.className = 'comm-comment-row';
        row.dataset.cid = c.id;
        row.innerHTML = `${pinBadge}<span class="comm-comment-user">${esc(c.username)}</span><span class="comm-comment-text">${esc(c.text)}</span><span class="comm-comment-ago">${timeAgo(c.created_at)}</span>${pinBtn}`;
        return row;
    }

    function loadComments(pid, commentsEl, isMine) {
        const list = commentsEl.querySelector('.comm-comments-list');
        commentsEl.dataset.loaded = 'true';
        list.innerHTML = '<div class="comm-comments-loading">loading…</div>';
        fetch(`/pug/api/community/${pid}/comments`)
            .then(r => r.json())
            .then(comments => {
                list.innerHTML = '';
                if (!comments.length) {
                    list.innerHTML = '<div class="comm-no-comments">No comments yet.</div>';
                    return;
                }
                comments.forEach(c => {
                    const row = buildCommentRow(c, isMine);
                    row.querySelector('.comm-pin-btn')?.addEventListener('click', function() {
                        fetch(`/pug/api/community/${pid}/comment/${c.id}/pin`, { method: 'POST' })
                            .then(r => r.json()).then(() => loadComments(pid, commentsEl, isMine)).catch(() => {});
                    });
                    list.appendChild(row);
                });
            })
            .catch(() => { list.innerHTML = ''; });
    }

    function loadPreviewComments(pid, postEl) {
        const preview = postEl.querySelector('.comm-comments-preview');
        if (!preview) return;
        fetch(`/pug/api/community/${pid}/comments`)
            .then(r => r.json())
            .then(comments => {
                preview.innerHTML = '';
                const top3 = comments.slice(-3);
                top3.forEach(c => {
                    const row = document.createElement('div');
                    row.className = 'comm-comment-preview-row';
                    row.innerHTML = `<span class="comm-comment-user">${esc(c.username)}</span><span class="comm-comment-text">${esc(c.text)}</span>`;
                    preview.appendChild(row);
                });
            }).catch(() => {});
    }

    function sendComment(pid, input, commentsEl, postEl) {
        const text = (input?.value || '').trim();
        if (!text) return;
        fetch(`/pug/api/community/${pid}/comment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        }).then(r => r.json()).then(data => {
            if (data.error) return;
            input.value = '';
            commentsEl.dataset.loaded = 'false';
            const isMine = postEl?.querySelector('.comm-del-btn') !== null;
            loadComments(pid, commentsEl, isMine);
            const countEl = postEl?.querySelector('[data-action="comment"] .react-count');
            if (countEl) countEl.textContent = parseInt(countEl.textContent || 0) + 1;
            loadPreviewComments(pid, postEl);
        }).catch(() => {});
    }

    function deletePost(id) {
        fetch(`/pug/api/community/${id}`, { method: 'DELETE' })
            .then(() => { lastPostCount = 0; loadFeed(); }).catch(() => {});
    }

    // ── XHR upload with progress ───────────────────────────────────────────────
    function uploadWithProgress(url, formData, progressEl, barEl) {
        return new Promise(resolve => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url);
            if (progressEl && barEl) { progressEl.classList.remove('hidden'); barEl.style.width = '0%'; }
            xhr.upload.onprogress = e => {
                if (e.lengthComputable && barEl) barEl.style.width = `${Math.round(e.loaded/e.total*100)}%`;
            };
            xhr.onload = () => {
                if (progressEl) progressEl.classList.add('hidden');
                if (barEl) barEl.style.width = '0%';
                try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
            };
            xhr.onerror = () => { if (progressEl) progressEl.classList.add('hidden'); resolve({}); };
            xhr.send(formData);
        });
    }

    // ── Tab switcher ───────────────────────────────────────────────────────────
    tabWrite?.addEventListener('click', () => switchTab('write'));
    tabQuick?.addEventListener('click', () => switchTab('quick'));

    function switchTab(tab) {
        activeTab = tab;
        tabWrite?.classList.toggle('active', tab === 'write');
        tabQuick?.classList.toggle('active', tab === 'quick');
        writePane?.classList.toggle('hidden', tab !== 'write');
        quickPane?.classList.toggle('hidden', tab !== 'quick');
    }

    // ── Compose modal open/close ───────────────────────────────────────────────
    composeBtn?.addEventListener('click', openModal);
    cancelPostBtn?.addEventListener('click', closeModal);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    function openModal() {
        pendingMedia = null; pendingQuick = null; activePostType = null;
        document.querySelectorAll('.comm-type-pill').forEach(p => p.classList.remove('active'));
        if (modalInput) modalInput.textContent = '';
        if (modalCharCount) modalCharCount.textContent = `0 / ${MAX_LEN}`;
        if (modalError) modalError.textContent = '';
        if (mediaPreview) { mediaPreview.innerHTML = ''; mediaPreview.classList.add('hidden'); }
        if (quickPreview) { quickPreview.innerHTML = ''; quickPreview.classList.add('hidden'); }
        if (quickPlaceholder) quickPlaceholder.classList.remove('hidden');
        if (quickCaption) quickCaption.value = '';
        if (quickCaptionCount) quickCaptionCount.textContent = '0 / 150';
        switchTab('write');
        commTitleBlock?.classList.add('hidden');
        composeBtn && (composeBtn.style.display = 'none');
        cancelPostBtn && (cancelPostBtn.style.display = '');
        inlineCompose?.classList.remove('hidden');
        setTimeout(() => modalInput?.focus(), 60);
    }

    function closeModal() {
        inlineCompose?.classList.add('hidden');
        commTitleBlock?.classList.remove('hidden');
        composeBtn && (composeBtn.style.display = '');
        cancelPostBtn && (cancelPostBtn.style.display = 'none');
        pendingMedia = null; pendingQuick = null; activePostType = null;
        document.querySelectorAll('.comm-type-pill').forEach(p => p.classList.remove('active'));
    }

    modalInput?.addEventListener('input', () => {
        const len = (modalInput.textContent || '').length;
        if (modalCharCount) {
            modalCharCount.textContent = `${len} / ${MAX_LEN}`;
            modalCharCount.style.color = len > MAX_LEN ? '#e87a5a' : '';
        }
    });

    quickCaption?.addEventListener('input', () => {
        const len = quickCaption.value.length;
        if (quickCaptionCount) quickCaptionCount.textContent = `${len} / 150`;
    });

    // ── Write tab media attach ─────────────────────────────────────────────────
    fileInput?.addEventListener('change', () => {
        const file = fileInput.files[0]; if (!file) return;
        const fd = new FormData(); fd.append('file', file);
        if (modalError) modalError.textContent = '';
        uploadWithProgress('/pug/api/upload_shared', fd, uploadProgress, progressBar)
            .then(data => {
                if (!data || data.error) { if (modalError) modalError.textContent = data?.error || 'Upload failed.'; return; }
                pendingMedia = data;
                renderMediaPreview(mediaPreview, data, () => { pendingMedia = null; });
            });
        fileInput.value = '';
    });

    // ── Quick tab media ────────────────────────────────────────────────────────
    quickZone?.addEventListener('click', () => quickFileInput?.click());
    quickFileInput?.addEventListener('change', () => {
        const file = quickFileInput.files[0]; if (!file) return;
        const fd = new FormData(); fd.append('file', file);
        if (modalError) modalError.textContent = '';
        if (quickPlaceholder) quickPlaceholder.classList.add('hidden');
        uploadWithProgress('/pug/api/upload_shared', fd, quickProgress, quickProgressBar)
            .then(data => {
                if (!data || data.error) {
                    if (quickPlaceholder) quickPlaceholder.classList.remove('hidden');
                    if (modalError) modalError.textContent = data?.error || 'Upload failed.';
                    return;
                }
                pendingQuick = data;
                renderQuickPreview(data);
            });
        quickFileInput.value = '';
    });

    function renderQuickPreview(media) {
        if (!quickPreview) return;
        quickPreview.innerHTML = '';
        let el;
        if (media.type === 'image') {
            el = document.createElement('img');
            el.src = media.url;
            el.className = 'comm-quick-preview-img';
        } else if (media.type === 'video') {
            el = document.createElement('video');
            el.src = media.url; el.controls = true;
            el.className = 'comm-quick-preview-video';
        } else {
            el = document.createElement('audio');
            el.src = media.url; el.controls = true;
            el.className = 'comm-quick-preview-audio';
        }
        const removeBtn = document.createElement('button');
        removeBtn.className = 'dm-media-remove'; removeBtn.textContent = '×';
        removeBtn.addEventListener('click', e => {
            e.stopPropagation();
            pendingQuick = null;
            quickPreview.innerHTML = ''; quickPreview.classList.add('hidden');
            if (quickPlaceholder) quickPlaceholder.classList.remove('hidden');
        });
        const wrap = document.createElement('div');
        wrap.className = 'dm-media-preview-wrap comm-quick-preview-wrap';
        wrap.appendChild(el); wrap.appendChild(removeBtn);
        quickPreview.appendChild(wrap);
        quickPreview.classList.remove('hidden');
    }

    function renderMediaPreview(container, media, onRemove) {
        if (!container) return;
        container.classList.remove('hidden'); container.innerHTML = '';
        let el;
        if (media.type === 'image') { el = document.createElement('img'); el.src = media.url; el.className = 'dm-media-preview-img'; }
        else if (media.type === 'video') { el = document.createElement('video'); el.src = media.url; el.controls = true; el.className = 'dm-media-preview-video'; }
        else { el = document.createElement('audio'); el.src = media.url; el.controls = true; el.className = 'dm-media-preview-audio'; }
        const removeBtn = document.createElement('button');
        removeBtn.className = 'dm-media-remove'; removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => { onRemove?.(); container.innerHTML = ''; container.classList.add('hidden'); });
        const wrap = document.createElement('div'); wrap.className = 'dm-media-preview-wrap';
        wrap.appendChild(el); wrap.appendChild(removeBtn);
        container.appendChild(wrap);
    }

    // ── Submit ─────────────────────────────────────────────────────────────────
    confirmPostBtn?.addEventListener('click', submitPost);
    modalInput?.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitPost(); });

    function submitPost() {
        if (posting) return;
        let text = '', media_key = '';

        if (activeTab === 'quick') {
            if (!pendingQuick) { if (modalError) modalError.textContent = 'Choose a photo, video, or audio first.'; return; }
            text      = quickCaption?.value.trim() || '';
            media_key = pendingQuick.key;
        } else {
            text = (modalInput?.textContent || '').trim();
            if (!text && !pendingMedia) { if (modalError) modalError.textContent = 'Write something or attach media.'; return; }
            if (text.length > MAX_LEN) { if (modalError) modalError.textContent = 'Too long.'; return; }
            media_key = pendingMedia?.key || '';
        }

        posting = true;
        if (confirmPostBtn) confirmPostBtn.disabled = true;
        const payload = { text, media_key };
        if (activePostType) payload.post_type = activePostType;
        fetch('/pug/api/community', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(r => r.json())
        .then(data => {
            posting = false; if (confirmPostBtn) confirmPostBtn.disabled = false;
            if (data.error) { if (modalError) modalError.textContent = data.error; return; }
            closeModal(); lastPostCount = 0; loadFeed();
        })
        .catch(() => { posting = false; if (confirmPostBtn) confirmPostBtn.disabled = false; });
    }

    // ── Public profile popup ───────────────────────────────────────────────────
    const pubModal     = document.getElementById('pubProfileModal');
    const pubAvatar    = document.getElementById('pubProfileAvatar');
    const pubName      = document.getElementById('pubProfileName');
    const pubRank      = document.getElementById('pubProfileRank');
    const pubClass     = document.getElementById('pubProfileClass');
    const pubSkills    = document.getElementById('pubProfileSkills');
    const pubEmpty     = document.getElementById('pubProfileEmpty');
    const closePub     = document.getElementById('closePubProfileBtn');
    const pubActions   = document.getElementById('pubProfileActions');

    closePub?.addEventListener('click', () => pubModal?.classList.add('hidden'));
    window.addEventListener('click', e => { if (e.target === pubModal) pubModal?.classList.add('hidden'); });

    pubActions?.querySelectorAll('.pub-action-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const uid      = parseInt(pubModal.dataset.uid || '0');
            const username = pubModal.dataset.username || '';
            if (!uid) return;
            pubModal.classList.add('hidden');
            document.getElementById('commDmLbar')?.classList.add('open');
            document.dispatchEvent(new CustomEvent('veyra:open-dm', { detail: { uid, username } }));
        });
    });

    function openProfile(uid, username) {
        if (!pubModal) return;
        pubModal.dataset.uid      = uid;
        pubModal.dataset.username = username;
        pubModal.classList.remove('hidden');
        if (pubAvatar) pubAvatar.textContent = (username||'?')[0].toUpperCase();
        if (pubName)   pubName.textContent   = username;
        if (pubRank)   pubRank.textContent   = '';
        if (pubClass)  pubClass.textContent  = '';
        if (pubSkills) pubSkills.innerHTML   = '';
        if (pubEmpty)  pubEmpty.classList.add('hidden');
        if (pubActions) pubActions.classList.remove('hidden');
        fetch(`/pug/api/users/${uid}/profile`)
            .then(r => r.json())
            .then(data => {
                if (data.rank && pubRank) { pubRank.textContent = data.rank; pubRank.style.color = data.rank_color||'#888'; }
                const sheet = data.sheet;
                if (!sheet) { pubEmpty?.classList.remove('hidden'); return; }
                if (pubClass && sheet.class_official) pubClass.textContent = sheet.class_official;
                const skills = sheet.skills || [];
                if (!skills.length) { pubEmpty?.classList.remove('hidden'); return; }
                const RC = {'S+':'#ffd700','S':'#ffb700','S-':'#ffa500','A+':'#ff7c4d','A':'#ff8c42','A-':'#e8854a','B+':'#5a8fc8','B':'#4a7aaa','B-':'#4070a0','C+':'#8ac888','C':'#78b878','C-':'#68a068','D+':'#a0a0a0','D':'#888888','D-':'#707070','E':'#c06030','F':'#803010'};
                skills.forEach(s => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);';
                    const ok = s.verified !== false;
                    row.innerHTML = `<span style="font-size:0.82rem;color:var(--text);">${esc(s.name)}</span><span style="font-family:var(--font-mono);font-size:0.72rem;font-weight:700;color:${ok ? (RC[s.rank]||'#888') : 'var(--text-dim)'};">${ok ? s.rank : '?'}</span>`;
                    pubSkills.appendChild(row);
                });
            })
            .catch(() => { pubEmpty?.classList.remove('hidden'); });
    }

    // ── Utils ──────────────────────────────────────────────────────────────────
    function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function timeAgo(iso) {
        if (!iso) return '';
        const d = (Date.now() - new Date(iso+'Z')) / 1000;
        if (d < 60) return 'now';
        if (d < 3600) return `${Math.floor(d/60)}m`;
        if (d < 86400) return `${Math.floor(d/3600)}h`;
        return `${Math.floor(d/86400)}d`;
    }

    // ── Init ───────────────────────────────────────────────────────────────────
    loadFeed();
    setInterval(loadFeed, 15000);
});
