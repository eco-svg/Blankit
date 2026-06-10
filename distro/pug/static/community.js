document.addEventListener('DOMContentLoaded', () => {

    // ── Buy info modal ────────────────────────────────────────────────────
    let _pendingBuy = null;
    const buyOverlay  = document.getElementById('buyInfoOverlay');
    const buyBtnCont  = document.getElementById('buyInfoContinue');
    const buyBtnCred  = document.getElementById('buyInfoCredits');
    if (buyOverlay) {
        buyOverlay.addEventListener('click', e => { if (e.target === buyOverlay) closeBuyModal(); });
        buyBtnCont?.addEventListener('click', () => {
            if (_pendingBuy) {
                const { uid, username, postId, autoMessage } = _pendingBuy;
                fetch(`/pug/api/community/${postId}/action`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'buy' })
                }).catch(() => {});
                document.getElementById('commDmLbar')?.classList.add('open');
                document.dispatchEvent(new CustomEvent('veyra:open-dm', { detail: { uid, username, autoMessage } }));
            }
            closeBuyModal();
        });
        buyBtnCred?.addEventListener('click', () => {
            closeBuyModal();
            window._veyraNavigate('credits', true);
        });
    }
    function openBuyModal(uid, username, postId, autoMessage) {
        _pendingBuy = { uid, username, postId, autoMessage };
        buyOverlay?.classList.remove('hidden');
    }
    function closeBuyModal() {
        _pendingBuy = null;
        buyOverlay?.classList.add('hidden');
    }

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
    const quickZone        = document.getElementById('commQuickZone');
    const quickPhotoInput  = document.getElementById('commQuickPhotoInput');
    const quickVideoInput  = document.getElementById('commQuickVideoInput');
    const quickPlaceholder = document.getElementById('commQuickPlaceholder');
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
    let activeSkillTag = null;
    let activeUserId   = null;
    let feedMode       = localStorage.getItem('veyra-comm-mode') || 'radar';

    // ── Skill picker ───────────────────────────────────────────────────────────
    const skillPickerEl = document.getElementById('commSkillPicker');
    let _mySkills = null;

    function loadMySkills(cb) {
        if (_mySkills !== null) { cb(_mySkills); return; }
        fetch('/pug/api/stats?cache_only=true')
            .then(r => r.json())
            .then(data => {
                _mySkills = (data.skills || []).map(s => s.name).filter(Boolean);
                cb(_mySkills);
            }).catch(() => { _mySkills = []; cb([]); });
    }

    function renderSkillPicker(skills) {
        if (!skillPickerEl) return;
        skillPickerEl.innerHTML = '';
        activeSkillTag = null;
        if (!skills.length) {
            skillPickerEl.innerHTML = '<span style="font-size:0.7rem;color:var(--text-dim);">No skills added yet.</span>';
            return;
        }
        skills.forEach(name => {
            const chip = document.createElement('button');
            chip.className = 'comm-skill-tag-chip';
            chip.textContent = name;
            chip.addEventListener('click', () => {
                if (activeSkillTag === name) {
                    activeSkillTag = null;
                    chip.classList.remove('active');
                } else {
                    activeSkillTag = name;
                    skillPickerEl.querySelectorAll('.comm-skill-tag-chip').forEach(c => c.classList.remove('active'));
                    chip.classList.add('active');
                }
            });
            skillPickerEl.appendChild(chip);
        });
    }

    // ── Feed mode toggle ───────────────────────────────────────────────────────
    document.querySelectorAll('.comm-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === feedMode);
        btn.addEventListener('click', () => {
            feedMode = btn.dataset.mode;
            localStorage.setItem('veyra-comm-mode', feedMode);
            document.querySelectorAll('.comm-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === feedMode));
            if (feedMode === 'radar' && myLat === null) locPrompt?.classList.remove('hidden');
            else locPrompt?.classList.add('hidden');
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

    // ── User search ────────────────────────────────────────────────────────────
    const searchBtn        = document.getElementById('commSearchBtn');
    const searchPanel      = document.getElementById('commSearchPanel');
    const searchInput      = document.getElementById('commSearchInput');
    const searchResults    = document.getElementById('commSearchResults');
    const userFilterBar    = document.getElementById('commUserFilterBar');
    const userFilterBack   = document.getElementById('commUserFilterBack');
    const userFilterLabel  = document.getElementById('commUserFilterLabel');

    searchBtn?.addEventListener('click', () => {
        const open = searchPanel.classList.toggle('hidden') === false;
        if (open) setTimeout(() => searchInput?.focus(), 60);
        else { searchResults.innerHTML = ''; searchInput.value = ''; }
    });

    let _searchTimer = null;
    searchInput?.addEventListener('input', () => {
        clearTimeout(_searchTimer);
        const q = searchInput.value.trim();
        if (q.length < 2) { searchResults.innerHTML = ''; return; }
        _searchTimer = setTimeout(() => {
            fetch(`/pug/api/users/search?q=${encodeURIComponent(q)}`)
                .then(r => r.ok ? r.json() : r.json().then(e => { throw e; }))
                .then(users => {
                    searchResults.innerHTML = '';
                    if (!Array.isArray(users) || !users.length) {
                        searchResults.innerHTML = '<div class="comm-search-empty">No users found.</div>';
                        return;
                    }
                    users.forEach(u => {
                        const row = document.createElement('div');
                        row.className = 'comm-search-user-row';
                        row.innerHTML = `
                            <div class="comm-avatar comm-search-av">${u.username[0].toUpperCase()}</div>
                            <span class="comm-search-uname">${esc(u.username)}</span>
                            ${u.rank ? `<span class="comm-rank-badge" style="color:${u.rank_color}">${esc(u.rank)}</span>` : ''}
                            <span class="online-dot${u.is_online ? ' is-online' : ''}" style="margin-left:auto;"></span>`;
                        row.addEventListener('click', () => openUserFilter(u.id, u.username));
                        searchResults.appendChild(row);
                    });
                }).catch(() => { searchResults.innerHTML = '<div class="comm-search-empty">No users found.</div>'; });
        }, 280);
    });

    function openUserFilter(uid, username) {
        activeUserId = uid;
        lastPostCount = 0;
        searchPanel.classList.add('hidden');
        searchInput.value = '';
        searchResults.innerHTML = '';
        userFilterBar.classList.remove('hidden');
        userFilterLabel.textContent = `Posts by ${username}`;
        loadFeed();
    }

    userFilterBack?.addEventListener('click', () => {
        activeUserId = null;
        lastPostCount = 0;
        userFilterBar.classList.add('hidden');
        userFilterLabel.textContent = '';
        loadFeed();
    });

    // ── Geolocation ────────────────────────────────────────────────────────────
    const locPrompt    = document.getElementById('commLocPrompt');
    const locPromptBtn = document.getElementById('commLocPromptBtn');

    function requestLocation() {
        if (!navigator.geolocation) return;
        locPrompt?.classList.add('hidden');
        navigator.geolocation.getCurrentPosition(pos => {
            myLat = pos.coords.latitude;
            myLng = pos.coords.longitude;
            locPrompt?.classList.add('hidden');
            fetch('/pug/api/location', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lat: myLat, lng: myLng })
            }).catch(() => {});
            lastPostCount = 0;
            loadFeed();
        }, () => {
            if (rangeLabel) { rangeLabel.classList.remove('locating'); rangeLabel.style.display = 'none'; }
            locPrompt?.classList.add('hidden');
        }, { timeout: 8000 });
    }

    locPromptBtn?.addEventListener('click', requestLocation);

    if (feedMode === 'radar') locPrompt?.classList.remove('hidden');
    requestLocation();

    // ── Feed ───────────────────────────────────────────────────────────────────
    function loadFeed() {
        let url = '/pug/api/community';
        const params = [];
        if (feedMode === 'radar' && myLat !== null && myLng !== null) {
            params.push(`lat=${myLat}`);
            params.push(`lng=${myLng}`);
        }
        if (activeSkill)  params.push(`skill=${encodeURIComponent(activeSkill)}`);
        if (activeUserId) params.push(`user_id=${activeUserId}`);
        if (params.length) url += '?' + params.join('&');
        fetch(url)
            .then(r => r.json())
            .then(data => {
                const posts  = Array.isArray(data) ? data : (data.posts || []);
                const radius = Array.isArray(data) ? null : data.radius_km;
                if (rangeLabel) {
                    rangeLabel.classList.remove('locating', 'has-range');
                    if (feedMode === 'global') {
                        rangeLabel.style.display = 'none';
                    } else if (radius) {
                        rangeLabel.style.display = '';
                        rangeLabel.classList.add('has-range');
                        rangeLabel.textContent = `within ${radius} km`;
                    } else {
                        rangeLabel.style.display = myLat !== null ? '' : 'none';
                        rangeLabel.textContent = 'no location';
                    }
                }
                // Diff update — never wipe the feed; preserves open comment sections
                const renderedMap = {};
                feed.querySelectorAll('.comm-post').forEach(el => { renderedMap[el.dataset.id] = el; });
                const newIdSet = new Set(posts.map(p => String(p.id)));

                // Remove posts no longer returned
                Object.keys(renderedMap).forEach(id => { if (!newIdSet.has(id)) renderedMap[id].remove(); });

                if (!posts.length) {
                    if (!feed.querySelector('.comm-post')) {
                        feed.innerHTML = activeUserId
                            ? '<div class="comm-empty">No posts by this user.</div>'
                            : '<div class="comm-empty">No posts yet. Be the first.</div>';
                    }
                    lastPostCount = 0;
                    return;
                }
                feed.querySelector('.comm-empty')?.remove();

                // Prepend only genuinely new posts, maintaining newest-first order
                const newPosts = posts.filter(p => !renderedMap[String(p.id)]);
                for (let i = newPosts.length - 1; i >= 0; i--) {
                    feed.insertBefore(makePost(newPosts[i]), feed.firstChild);
                }
                lastPostCount = posts.length;
            })
            .catch(() => {});
    }


    function fmtDist(km) {
        if (km === null || km === undefined) return '';
        if (km < 1) return `${Math.round(km * 1000)} m`;
        return `${km.toFixed(1)} km`;
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
        const distHtml = (!p.is_mine && feedMode === 'radar' && p.dist_km !== null && p.dist_km !== undefined)
            ? `<span class="comm-dist-badge">${fmtDist(p.dist_km)}</span>` : '';

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

        const usernameHtml = `<button class="comm-username comm-username-link" data-uid="${p.user_id}">${esc(p.username)}</button>`;

        const isShowOff = p.post_type === 'showoff';
        const mine      = p.is_mine ? '1' : '';
        const uid_      = p.user_id;
        const uname_    = esc(p.username);

        const likeActive    = p.my_reaction === 'like'    ? ' active' : '';
        const dislikeActive = p.my_reaction === 'dislike' ? ' active' : '';

        // ShowOff only: Buy, Collab, Learn, Hire — only on OTHER people's posts
        const actionBtns = (isShowOff && !p.is_mine) ? `
            <button class="comm-action-btn comm-action-buy"    data-uid="${uid_}" data-username="${uname_}">Buy</button>
            <button class="comm-action-btn comm-action-collab" data-uid="${uid_}" data-username="${uname_}">Collab</button>
            <button class="comm-action-btn comm-action-learn"  data-uid="${uid_}" data-username="${uname_}">Learn</button>
            <button class="comm-action-btn comm-action-hire"   data-uid="${uid_}" data-username="${uname_}">Hire</button>` : '';

        const skillTagHtml = p.skill_tag
            ? `<span class="comm-skill-tag-badge">${esc(p.skill_tag)}</span>` : '';

        // Type switcher — compact inline pill in the post header (own posts only)
        const typeSwitcher = p.is_mine ? `
            <div class="comm-type-sw-inline">
                <button class="comm-type-sw-btn${!isShowOff ? ' active' : ''}" data-type="blog">Blog</button>
                <button class="comm-type-sw-btn${isShowOff ? ' active' : ''}" data-type="showoff">ShowOff</button>
            </div>` : '';

        el.innerHTML = `
            <div class="comm-post-header">
                <div class="comm-avatar-wrap">
                    <div class="comm-avatar">${initials}</div>
                    <span class="online-dot${p.is_online ? ' is-online' : ''}"></span>
                </div>
                <div class="comm-meta">
                    ${typeSwitcher}
                    ${usernameHtml}
                    ${rankHtml}
                    <span class="comm-distro-tag">${esc(p.distro)}</span>
                    ${skillTagHtml}
                </div>
                <div class="comm-post-reactions">
                    <button class="comm-react-btn${likeActive}" data-action="like"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/></svg> <span class="react-count">${p.likes||0}</span></button>
                    <button class="comm-react-btn${dislikeActive}" data-action="dislike"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z"/></svg> <span class="react-count">${p.dislikes||0}</span></button>
                    <button class="comm-react-btn" data-action="comment"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> <span class="react-count">${p.comment_count||0}</span></button>
                    <button class="comm-react-btn comm-share-btn" data-action="share"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg></button>
                </div>
                <div class="comm-action-btns">${actionBtns}</div>
                <div class="comm-post-hdr-right">
                    ${distHtml}
                    <span class="comm-ago">${ago}</span>
                    ${deleteBtn}
                </div>
            </div>
            ${(p.text && p.media_url) ? `<div class="comm-post-content"><div class="comm-post-body">${esc(p.text)}</div>${mediaHtml}</div>` : (p.text ? `<div class="comm-post-body">${esc(p.text)}</div>` : '') + mediaHtml}
            <div class="comm-comments-preview"></div>
            <div class="comm-post-comments hidden">
                <div class="comm-comments-list"></div>
                <div class="comm-comment-input-row">
                    <input type="text" class="comm-comment-input" placeholder="Add a comment..." maxlength="300" autocomplete="off">
                    <button class="comm-comment-send">→</button>
                </div>
            </div>`;

        el.querySelector('.comm-del-btn')?.addEventListener('click', () => deletePost(p.id));
        el.querySelector('.comm-username-link')?.addEventListener('click', e => openProfile(p.user_id, p.username, p.is_mine, e));

        // ShowOff action buttons — open DM + award EXP to post author
        const _ACTION_MESSAGES = {
            'comm-action-hire':   () => `Hey! ${_myName} wants to hire you! 👋`,
            'comm-action-collab': () => `Hey! ${_myName} wants to collab with you! 🤝`,
            'comm-action-learn':  () => `Hey! ${_myName} wants to learn from you! 📚`,
            'comm-action-buy':    () => `Hey! ${_myName} wants to buy from you! 🛒`,
        };
        const _ACTION_KEY = {
            'comm-action-hire': 'hire', 'comm-action-collab': 'collab',
            'comm-action-learn': 'learn', 'comm-action-buy': 'buy',
        };
        el.querySelectorAll('.comm-action-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const uid         = parseInt(this.dataset.uid);
                const username    = this.dataset.username;
                const cls         = Array.from(this.classList).find(c => _ACTION_MESSAGES[c]);
                const snippet     = p.body ? p.body.replace(/<[^>]+>/g, '').trim().substring(0, 80) : '';
                const autoMessage = cls ? (snippet ? `§§POST§§${snippet}${snippet.length >= 80 ? '…' : ''}§§END§§\n` : '') + _ACTION_MESSAGES[cls]() : null;
                const actionKey   = cls ? _ACTION_KEY[cls] : null;
                if (cls === 'comm-action-buy') {
                    openBuyModal(uid, username, p.id, autoMessage);
                    return;
                }
                if (actionKey) {
                    fetch(`/pug/api/community/${p.id}/action`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: actionKey })
                    }).catch(() => {});
                }
                document.getElementById('commDmLbar')?.classList.add('open');
                document.dispatchEvent(new CustomEvent('veyra:open-dm', { detail: { uid, username, autoMessage } }));
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
                    const actionContainer = el.querySelector('.comm-action-btns');
                    if (actionContainer) {
                        if (nowShowOff) {
                            actionContainer.innerHTML = `
                                <button class="comm-action-btn comm-action-buy"    data-uid="${uid_}" data-username="${uname_}">Buy</button>
                                <button class="comm-action-btn comm-action-collab" data-uid="${uid_}" data-username="${uname_}">Collab</button>
                                <button class="comm-action-btn comm-action-learn"  data-uid="${uid_}" data-username="${uname_}">Learn</button>
                                <button class="comm-action-btn comm-action-hire"   data-uid="${uid_}" data-username="${uname_}">Hire</button>`;
                            actionContainer.querySelectorAll('.comm-action-btn').forEach(b => {
                                b.addEventListener('click', function() {
                                    const uid2        = parseInt(this.dataset.uid);
                                    const username2   = this.dataset.username;
                                    const cls2        = Array.from(this.classList).find(c => _ACTION_MESSAGES[c]);
                                    const snippet2    = p.body ? p.body.replace(/<[^>]+>/g, '').trim().substring(0, 80) : '';
                                    const autoMessage = cls2 ? (snippet2 ? `§§POST§§${snippet2}${snippet2.length >= 80 ? '…' : ''}§§END§§\n` : '') + _ACTION_MESSAGES[cls2]() : null;
                                    const actionKey2  = cls2 ? _ACTION_KEY[cls2] : null;
                                    if (cls2 === 'comm-action-buy') {
                                        openBuyModal(uid2, username2, p.id, autoMessage);
                                        return;
                                    }
                                    if (actionKey2) fetch(`/pug/api/community/${p.id}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: actionKey2 }) }).catch(() => {});
                                    document.getElementById('commDmLbar')?.classList.add('open');
                                    document.dispatchEvent(new CustomEvent('veyra:open-dm', { detail: { uid: uid2, username: username2, autoMessage } }));
                                });
                            });
                        } else {
                            actionContainer.innerHTML = '';
                        }
                    }
                }).catch(() => {});
            });
        });

        // Reactions
        el.querySelectorAll('.comm-react-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                if (action === 'share') {
                    openSharePopup(btn, p);
                    return;
                }
                if (action === 'comment') {
                    const preview    = el.querySelector('.comm-comments-preview');
                    const commentsEl = el.querySelector('.comm-post-comments');
                    preview?.classList.add('hidden');
                    const nowVisible = commentsEl.classList.toggle('hidden') === false;
                    if (nowVisible) {
                        if (commentsEl.dataset.loaded !== 'true') {
                            loadComments(p.id, commentsEl, p.is_mine);
                        }
                        clearInterval(commentsEl._pollTimer);
                        commentsEl._pollTimer = setInterval(() => {
                            if (commentsEl.classList.contains('hidden')) {
                                clearInterval(commentsEl._pollTimer);
                            } else {
                                commentsEl.dataset.loaded = 'false';
                                loadComments(p.id, commentsEl, p.is_mine);
                            }
                        }, 5000);
                    } else {
                        clearInterval(commentsEl._pollTimer);
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

        // Double-click anywhere on the post (not a button/link) to auto-like
        el.addEventListener('dblclick', e => {
            if (e.target.closest('button,a,input')) return;
            el.querySelector('[data-action="like"]')?.click();
            const heart = document.createElement('span');
            heart.className = 'heart-pop';
            heart.textContent = '❤️';
            heart.style.left = e.clientX + 'px';
            heart.style.top  = e.clientY + 'px';
            document.body.appendChild(heart);
            setTimeout(() => heart.remove(), 800);
        });

        return el;
    }

    function buildCommentRow(c, isMine) {
        const pinBtn = c.can_pin
            ? `<button class="comm-pin-btn${c.is_pinned ? ' pinned' : ''}" data-cid="${c.id}" title="${c.is_pinned ? 'Unpin' : 'Pin'}">📌</button>` : '';
        const pinBadge = c.is_pinned ? `<span class="comm-pin-badge">pinned</span>` : '';
        const likeAct = c.my_reaction === 'like'    ? ' active' : '';
        const disAct  = c.my_reaction === 'dislike' ? ' active' : '';
        const initials = (c.username || '?')[0].toUpperCase();
        const row = document.createElement('div');
        row.className = 'comm-comment-row';
        row.dataset.cid = c.id;
        const _thumbUp   = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/></svg>`;
        const _thumbDown = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z"/></svg>`;
        const _replyIco  = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>`;
        row.innerHTML = `${pinBadge}<div class="comm-comment-av comm-username-link" data-uid="${c.user_id||''}" data-username="${esc(c.username)}">${initials}</div><div class="comm-comment-content"><span class="comm-comment-user comm-username-link" data-uid="${c.user_id||''}" data-username="${esc(c.username)}">${esc(c.username)}</span><span class="comm-comment-text">${esc(c.text)}</span></div><div class="comm-comment-actions"><span class="comm-comment-ago">${timeAgo(c.created_at)}</span><button class="comm-comment-react${likeAct}" data-action="like" data-cid="${c.id}">${_thumbUp} <span class="cmt-cnt">${c.likes||0}</span></button><button class="comm-comment-react${disAct}" data-action="dislike" data-cid="${c.id}">${_thumbDown} <span class="cmt-cnt">${c.dislikes||0}</span></button><button class="comm-comment-react" data-action="reply" data-username="${esc(c.username)}">${_replyIco}</button>${pinBtn}</div>`;
        row.querySelectorAll('.comm-username-link').forEach(el => {
            el.addEventListener('click', e => {
                e.stopPropagation();
                const uid = parseInt(el.dataset.uid);
                if (uid) openProfile(uid, c.username, c.is_mine, e);
            });
        });
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
                    row.querySelectorAll('.comm-comment-react').forEach(btn => {
                        btn.addEventListener('click', function() {
                            const action = this.dataset.action;
                            if (action === 'reply') {
                                const input = commentsEl.querySelector('.comm-comment-input');
                                if (input) { input.value = `@${this.dataset.username} `; input.focus(); }
                                return;
                            }
                            fetch(`/pug/api/community/${pid}/comment/${this.dataset.cid}/react`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ type: action })
                            }).then(r => r.json()).then(data => {
                                row.querySelector('[data-action="like"] .cmt-cnt').textContent    = data.likes    || 0;
                                row.querySelector('[data-action="dislike"] .cmt-cnt').textContent = data.dislikes || 0;
                                row.querySelector('[data-action="like"]').classList.toggle('active',    data.my_reaction === 'like');
                                row.querySelector('[data-action="dislike"]').classList.toggle('active', data.my_reaction === 'dislike');
                            }).catch(() => {});
                        });
                    });
                    list.appendChild(row);
                });
            })
            .catch(() => { list.innerHTML = ''; });
    }

    function loadPreviewComments(pid, postEl) {
        const preview    = postEl.querySelector('.comm-comments-preview');
        const commentsEl = postEl.querySelector('.comm-post-comments');
        if (!preview) return;
        fetch(`/pug/api/community/${pid}/comments`)
            .then(r => r.json())
            .then(comments => {
                preview.innerHTML = '';
                comments.slice(0, 3).forEach(c => {
                    const row = buildCommentRow(c, false);
                    row.querySelector('.comm-pin-btn')?.addEventListener('click', () => {
                        fetch(`/pug/api/community/${pid}/comment/${c.id}/pin`, { method: 'POST' })
                            .then(r => r.json()).then(() => loadPreviewComments(pid, postEl)).catch(() => {});
                    });
                    row.querySelectorAll('.comm-comment-react').forEach(btn => {
                        btn.addEventListener('click', function() {
                            const action = this.dataset.action;
                            if (action === 'reply') {
                                const input = commentsEl?.querySelector('.comm-comment-input');
                                commentsEl?.classList.remove('hidden');
                                if (input) { input.value = `@${this.dataset.username} `; input.focus(); }
                                return;
                            }
                            fetch(`/pug/api/community/${pid}/comment/${this.dataset.cid}/react`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ type: action })
                            }).then(r => r.json()).then(data => {
                                row.querySelector('[data-action="like"] .cmt-cnt').textContent    = data.likes    || 0;
                                row.querySelector('[data-action="dislike"] .cmt-cnt').textContent = data.dislikes || 0;
                                row.querySelector('[data-action="like"]').classList.toggle('active',    data.my_reaction === 'like');
                                row.querySelector('[data-action="dislike"]').classList.toggle('active', data.my_reaction === 'dislike');
                            }).catch(() => {});
                        });
                    });
                    preview.appendChild(row);
                });
            }).catch(() => {});
    }

    function sendComment(pid, input, commentsEl, postEl) {
        const text = (input?.value || '').trim();
        if (!text || input.dataset.sending) return;
        input.dataset.sending = '1';
        input.value = '';
        fetch(`/pug/api/community/${pid}/comment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        }).then(r => r.json()).then(data => {
            if (data.error) { input.value = text; return; }
            commentsEl.dataset.loaded = 'false';
            const isMine = postEl?.querySelector('.comm-del-btn') !== null;
            loadComments(pid, commentsEl, isMine);
            const countEl = postEl?.querySelector('[data-action="comment"] .react-count');
            if (countEl) countEl.textContent = parseInt(countEl.textContent || 0) + 1;
            loadPreviewComments(pid, postEl);
        }).catch(() => { input.value = text; })
          .finally(() => { delete input.dataset.sending; });
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
        pendingMedia = null; pendingQuick = null; activePostType = null; activeSkillTag = null;
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
        loadMySkills(renderSkillPicker);
        setTimeout(() => modalInput?.focus(), 60);
    }

    function closeModal() {
        inlineCompose?.classList.add('hidden');
        commTitleBlock?.classList.remove('hidden');
        composeBtn && (composeBtn.style.display = '');
        cancelPostBtn && (cancelPostBtn.style.display = 'none');
        pendingMedia = null; pendingQuick = null; activePostType = null; activeSkillTag = null;
        document.querySelectorAll('.comm-type-pill').forEach(p => p.classList.remove('active'));
        if (skillPickerEl) skillPickerEl.innerHTML = '';
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
    function uploadQuickFile(file) {
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
    }

    // Fallback file inputs (used when getUserMedia is denied/unavailable)
    quickPhotoInput?.addEventListener('change', () => {
        const f = quickPhotoInput.files[0]; if (!f) return;
        uploadQuickFile(f); quickPhotoInput.value = '';
    });
    quickVideoInput?.addEventListener('change', () => {
        const f = quickVideoInput.files[0]; if (!f) return;
        uploadQuickFile(f); quickVideoInput.value = '';
    });

    // ── Camera recorder modal ──────────────────────────────────────────────────
    const camOverlay    = document.getElementById('camRecorderOverlay');
    const camVideo      = document.getElementById('camRecorderVideo');
    const camCanvas     = document.getElementById('camRecorderCanvas');
    const camActions    = document.getElementById('camRecorderActions');
    const camClose      = document.getElementById('camRecorderClose');
    let camStream       = null;
    let mediaRecorder   = null;
    let recordChunks    = [];

    function stopCamStream() {
        if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
        if (camVideo) camVideo.srcObject = null;
    }

    function closeCamModal() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        mediaRecorder = null; recordChunks = [];
        stopCamStream();
        camOverlay?.classList.add('hidden');
        if (camActions) camActions.innerHTML = '';
    }

    async function openCameraModal(mode) {
        camOverlay?.classList.remove('hidden');
        if (camActions) camActions.innerHTML = '';

        const constraints = mode === 'video'
            ? { video: { facingMode: 'environment' }, audio: true }
            : { video: { facingMode: 'environment' } };

        try {
            camStream = await navigator.mediaDevices.getUserMedia(constraints);
            camVideo.srcObject = camStream;
            if (mode === 'photo') buildPhotoCaptureBtn();
            else buildVideoRecordBtns();
        } catch (_) {
            closeCamModal();
            if (mode === 'photo') quickPhotoInput?.click();
            else quickVideoInput?.click();
        }
    }

    function buildPhotoCaptureBtn() {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cam-action-btn cam-action-capture';
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg><span>Capture</span>';
        btn.addEventListener('click', () => {
            const w = camVideo.videoWidth, h = camVideo.videoHeight;
            camCanvas.width = w; camCanvas.height = h;
            camCanvas.getContext('2d').drawImage(camVideo, 0, 0, w, h);
            camCanvas.toBlob(blob => {
                if (!blob) return;
                closeCamModal();
                uploadQuickFile(new File([blob], 'capture.jpg', { type: 'image/jpeg' }));
            }, 'image/jpeg', 0.92);
        });
        camActions.appendChild(btn);
    }

    function buildVideoRecordBtns() {
        const startBtn = document.createElement('button');
        startBtn.type = 'button';
        startBtn.className = 'cam-action-btn cam-action-record';
        startBtn.innerHTML = '<span class="cam-rec-dot"></span><span>Record</span>';

        const stopBtn = document.createElement('button');
        stopBtn.type = 'button';
        stopBtn.className = 'cam-action-btn cam-action-stop hidden';
        stopBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg><span>Stop</span>';

        startBtn.addEventListener('click', () => {
            recordChunks = [];
            const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
                ? 'video/webm;codecs=vp9' : 'video/webm';
            mediaRecorder = new MediaRecorder(camStream, { mimeType: mime });
            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordChunks.push(e.data); };
            mediaRecorder.onstop = () => {
                const blob = new Blob(recordChunks, { type: 'video/webm' });
                closeCamModal();
                uploadQuickFile(new File([blob], 'recording.webm', { type: 'video/webm' }));
            };
            mediaRecorder.start();
            startBtn.classList.add('hidden');
            stopBtn.classList.remove('hidden');
        });

        stopBtn.addEventListener('click', () => {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        });

        camActions.appendChild(startBtn);
        camActions.appendChild(stopBtn);
    }

    camClose?.addEventListener('click', closeCamModal);
    camOverlay?.addEventListener('click', e => { if (e.target === camOverlay) closeCamModal(); });

    document.getElementById('commCapturePhotoBtn')?.addEventListener('click', () => openCameraModal('photo'));
    document.getElementById('commCaptureVideoBtn')?.addEventListener('click', () => openCameraModal('video'));

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
        if (activeSkillTag) payload.skill_tag = activeSkillTag;
        fetch('/pug/api/community', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(r => r.json().then(data => ({ ok: r.ok, status: r.status, data })))
        .then(({ ok, status, data }) => {
            posting = false; if (confirmPostBtn) confirmPostBtn.disabled = false;
            if (!ok) {
                if (modalError) modalError.textContent = data.error || (status === 429 ? 'Slow down — too many posts.' : 'Something went wrong.');
                return;
            }
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
    document.addEventListener('click', e => {
        if (pubModal && !pubModal.classList.contains('hidden') && !pubModal.contains(e.target) && !e.target.closest('.comm-username-link'))
            pubModal.classList.add('hidden');
    });

    const _myName = document.querySelector('.greeting-name')?.textContent?.trim() || 'Someone';
    const PUB_ACTION_MESSAGES = {
        'pub-action-hire':   () => `Hey! ${_myName} wants to hire you! 👋`,
        'pub-action-collab': () => `Hey! ${_myName} wants to collab with you! 🤝`,
        'pub-action-friend': () => `Hey! ${_myName} wants to connect with you! 👋`,
    };

    pubActions?.querySelectorAll('.pub-action-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const uid      = parseInt(pubModal.dataset.uid || '0');
            const username = pubModal.dataset.username || '';
            if (!uid) return;
            const cls = Array.from(btn.classList).find(c => PUB_ACTION_MESSAGES[c]);
            const autoMessage = cls ? PUB_ACTION_MESSAGES[cls]() : null;
            pubModal.classList.add('hidden');
            document.getElementById('commDmLbar')?.classList.add('open');
            document.dispatchEvent(new CustomEvent('veyra:open-dm', { detail: { uid, username, autoMessage } }));
        });
    });

    const pubConnections  = document.getElementById('pubProfileConnections');
    const pubOnlineDot    = document.getElementById('pubOnlineDot');
    const pubOnlineLabel  = document.getElementById('pubProfileOnlineLabel');

    function openProfile(uid, username, isMine = false, evt = null) {
        if (!pubModal) return;
        pubModal.dataset.uid      = uid;
        pubModal.dataset.username = username;
        pubModal.classList.remove('hidden');
        const W = 278, H = 360;
        pubModal.style.left = Math.round((window.innerWidth  - W) / 2) + 'px';
        pubModal.style.top  = Math.round((window.innerHeight - H) / 2) + 'px';
        if (pubAvatar)      pubAvatar.textContent      = (username||'?')[0].toUpperCase();
        if (pubName)        pubName.textContent        = username;
        if (pubRank)        pubRank.textContent        = '';
        if (pubClass)       pubClass.textContent       = '';
        if (pubConnections) pubConnections.textContent = '';
        if (pubOnlineLabel) { pubOnlineLabel.textContent = ''; pubOnlineLabel.className = 'pps-online-label'; }
        if (pubOnlineDot)   { pubOnlineDot.className = 'online-dot'; }
        if (pubSkills)      pubSkills.innerHTML        = '';
        if (pubEmpty)       pubEmpty.classList.add('hidden');
        if (pubActions)     pubActions.classList.toggle('hidden', isMine);
        fetch(`/pug/api/users/${uid}/profile`)
            .then(r => r.json())
            .then(data => {
                if (data.rank && pubRank) { pubRank.textContent = data.rank; pubRank.style.color = data.rank_color||'#888'; }
                if (pubConnections && data.connections !== undefined)
                    pubConnections.textContent = `${data.connections} connection${data.connections !== 1 ? 's' : ''}`;
                if (data.is_online) {
                    if (pubOnlineDot)   pubOnlineDot.classList.add('is-online');
                    if (pubOnlineLabel) { pubOnlineLabel.textContent = '● Online'; pubOnlineLabel.classList.add('is-online'); }
                } else {
                    if (pubOnlineLabel) pubOnlineLabel.textContent = '○ Offline';
                }
                const sheet = data.sheet;
                if (!sheet) { pubEmpty?.classList.remove('hidden'); return; }
                if (pubClass && sheet.class_official) pubClass.textContent = sheet.class_official;
                const skills = sheet.skills || [];
                if (!skills.length) { pubEmpty?.classList.remove('hidden'); return; }
                const RC = {'S+':'#ffd700','S':'#ffb700','S-':'#ffa500','A+':'#ff7c4d','A':'#ff8c42','A-':'#e8854a','B+':'#5a8fc8','B':'#4a7aaa','B-':'#4070a0','C+':'#8ac888','C':'#78b878','C-':'#68a068','D+':'#a0a0a0','D':'#888888','D-':'#707070','E':'#c06030','F':'#803010'};
                skills.forEach(s => {
                    const row = document.createElement('div');
                    row.className = 'pps-skill-row';
                    const ok = s.verified !== false;
                    row.innerHTML = `<span>${esc(s.name)}</span><span class="pps-skill-rank" style="color:${ok ? (RC[s.rank]||'#888') : 'var(--text-dim)'};">${ok ? s.rank : '?'}</span>`;
                    pubSkills.appendChild(row);
                });
            })
            .catch(() => { pubEmpty?.classList.remove('hidden'); });
    }

    // ── Share popup ────────────────────────────────────────────────────────────
    let _sharePopup = null;
    function openSharePopup(btn, p) {
        const isMobile = navigator.maxTouchPoints > 0 && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
        if (navigator.share && isMobile) {
            const postUrl = `${location.origin}${location.pathname}?post=${p.id}`;
            navigator.share({ title: p.text ? p.text.slice(0, 80) : 'Check this out on Veyra', url: postUrl }).catch(() => {});
            return;
        }
        if (_sharePopup) _sharePopup.remove();
        const postUrl = `${location.origin}${location.pathname}?post=${p.id}`;
        const title   = p.text ? p.text.slice(0, 80) : 'Check this out on Veyra';
        const enc     = encodeURIComponent(postUrl);
        const encT    = encodeURIComponent(title + ' — ');

        const pop = document.createElement('div');
        pop.className = 'comm-share-popup';
        pop.innerHTML = `
            <div class="csp-copied"><span class="csp-copied-icon">🔗</span><span class="csp-copied-text">Copying link…</span></div>
            <div class="csp-divider"></div>
            <div class="csp-platforms">
                <a class="csp-btn csp-wa"  href="https://wa.me/?text=${encT}${enc}"        target="_blank" rel="noopener">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    WhatsApp
                </a>
                <a class="csp-btn csp-tg"  href="https://t.me/share/url?url=${enc}&text=${encT}" target="_blank" rel="noopener">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                    Telegram
                </a>
                <a class="csp-btn csp-x"   href="https://twitter.com/intent/tweet?url=${enc}&text=${encT}" target="_blank" rel="noopener">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    X
                </a>
                <button class="csp-btn csp-copy">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                    Copy link
                </button>
            </div>`;
        _sharePopup = pop;

        // position near button
        document.body.appendChild(pop);
        const rect = btn.getBoundingClientRect();
        const pw = pop.offsetWidth || 220;
        let left = rect.left + rect.width / 2 - pw / 2;
        let top  = rect.bottom + window.scrollY + 8;
        if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
        if (left < 8) left = 8;
        pop.style.left = left + 'px';
        pop.style.top  = top  + 'px';

        // auto copy
        function doCopy() {
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(postUrl).then(showCopied).catch(legacyCopy);
            } else {
                legacyCopy();
            }
        }
        function legacyCopy() {
            const ta = document.createElement('textarea');
            ta.value = postUrl;
            ta.style.cssText = 'position:fixed;opacity:0;top:-9999px;left:-9999px';
            document.body.appendChild(ta); ta.focus(); ta.select();
            try { document.execCommand('copy'); } catch(e) {}
            document.body.removeChild(ta);
            showCopied();
        }
        function showCopied() {
            const t = pop.querySelector('.csp-copied-text');
            const i = pop.querySelector('.csp-copied-icon');
            if (t) t.textContent = 'Link copied!';
            if (i) i.textContent = '✓';
            pop.querySelector('.csp-copied')?.classList.add('done');
        }
        doCopy();

        pop.querySelector('.csp-copy')?.addEventListener('click', doCopy);

        // close on outside click
        setTimeout(() => {
            function onOutside(e) {
                if (!pop.contains(e.target) && e.target !== btn) {
                    pop.remove(); _sharePopup = null;
                    document.removeEventListener('click', onOutside);
                }
            }
            document.addEventListener('click', onOutside);
        }, 0);

        // auto-dismiss after 8s
        setTimeout(() => { pop.remove(); _sharePopup = null; }, 8000);
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
    const linkedPostId = new URLSearchParams(location.search).get('post');

    function highlightPost(el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('comm-post-highlighted');
        setTimeout(() => el.classList.remove('comm-post-highlighted'), 3000);
    }

    function maybeInjectLinkedPost(pid) {
        const existing = feed.querySelector(`[data-id="${pid}"]`);
        if (existing) { highlightPost(existing); return; }
        fetch(`/pug/api/community/${pid}`)
            .then(r => r.ok ? r.json() : null)
            .then(p => {
                if (!p || p.error) return;
                const banner = document.createElement('div');
                banner.className = 'comm-linked-banner';
                banner.textContent = 'Shared post';
                const postEl = makePost(p);
                postEl.prepend(banner);
                feed.prepend(postEl);
                highlightPost(postEl);
            }).catch(() => {});
    }

    const origLoadFeed = loadFeed;
    if (linkedPostId) {
        const _origLoad = loadFeed;
        loadFeed = function() {
            const result = _origLoad.apply(this, arguments);
            // after fetch settles, try to highlight
            setTimeout(() => maybeInjectLinkedPost(parseInt(linkedPostId)), 600);
            return result;
        };
        // clean the URL so sharing again doesn't re-trigger
        history.replaceState(null, '', location.pathname);
    }

    loadFeed();
    setInterval(origLoadFeed, 15000);
});
