document.addEventListener('DOMContentLoaded', () => {

    const feed           = document.getElementById('commFeed');
    const composeBtn     = document.getElementById('commComposeBtn');
    const composeModal   = document.getElementById('commComposeModal');
    const cancelPostBtn  = document.getElementById('cancelCommPostBtn');
    const confirmPostBtn = document.getElementById('confirmCommPostBtn');
    const modalInput     = document.getElementById('commModalInput');
    const modalCharCount = document.getElementById('commModalCharCount');
    const modalError     = document.getElementById('commModalError');
    const fileInput      = document.getElementById('commFileInput');
    const attachLabel    = document.getElementById('commAttachLabel');
    const mediaPreview   = document.getElementById('commModalMediaPreview');
    const rangeLabel     = document.getElementById('commRangeLabel');

    const MAX_LEN = 500;
    let lastPostCount = 0;
    let posting       = false;
    let pendingMedia  = null;   // { key, url, type }
    let myLat = null, myLng = null;

    // ── Geolocation (opt-in) ─────────────────────────────────────────────────
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

    // ── Feed ──────────────────────────────────────────────────────────────────
    function loadFeed() {
        let url = '/pug/api/community';
        if (myLat !== null && myLng !== null) {
            url += `?lat=${myLat}&lng=${myLng}`;
        }
        fetch(url)
            .then(r => r.json())
            .then(data => {
                // API returns {posts:[...], radius_km:...} or legacy array
                const posts = Array.isArray(data) ? data : (data.posts || []);
                const radius = Array.isArray(data) ? null : data.radius_km;

                if (rangeLabel) {
                    rangeLabel.textContent = radius
                        ? `within ${radius} km`
                        : 'all · global';
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
        const el = document.createElement('div');
        el.className = 'comm-post';
        el.dataset.id = p.id;

        const initials  = (p.username || '?')[0].toUpperCase();
        const ago       = timeAgo(p.created_at);
        const rankHtml  = p.rank
            ? `<span class="comm-rank-badge" style="color:${p.rank_color};">${p.rank}</span>`
            : '';
        const deleteBtn = p.is_mine
            ? `<button class="comm-del-btn" data-id="${p.id}" title="Delete">×</button>`
            : '';

        let mediaHtml = '';
        if (p.media_url) {
            const ext = (p.media_key || '').split('.').pop().toLowerCase();
            if (['mp3','wav','ogg','m4a','flac'].includes(ext)) {
                mediaHtml = `<audio class="comm-media-audio" controls src="${p.media_url}"></audio>`;
            } else if (['mp4','webm'].includes(ext)) {
                mediaHtml = `<video class="comm-media-video" controls src="${p.media_url}" playsinline></video>`;
            } else {
                mediaHtml = `<img class="comm-media-img" src="${p.media_url}" loading="lazy">`;
            }
        }

        const usernameHtml = p.is_mine
            ? `<span class="comm-username">${esc(p.username)}</span>`
            : `<button class="comm-username comm-username-link" data-uid="${p.user_id}">${esc(p.username)}</button>`;

        el.innerHTML = `
            <div class="comm-post-header">
                <div class="comm-avatar">${initials}</div>
                <div class="comm-meta">
                    ${usernameHtml}
                    ${rankHtml}
                    <span class="comm-distro-tag">${esc(p.distro)}</span>
                </div>
                <span class="comm-ago">${ago}</span>
                ${deleteBtn}
            </div>
            ${p.text ? `<div class="comm-post-body">${esc(p.text)}</div>` : ''}
            ${mediaHtml}`;

        el.querySelector('.comm-del-btn')?.addEventListener('click', () => deletePost(p.id));
        el.querySelector('.comm-username-link')?.addEventListener('click', () => openProfile(p.user_id, p.username));
        return el;
    }

    function deletePost(id) {
        fetch(`/pug/api/community/${id}`, { method: 'DELETE' })
            .then(() => { lastPostCount = 0; loadFeed(); })
            .catch(() => {});
    }

    // ── Compose modal ─────────────────────────────────────────────────────────
    composeBtn?.addEventListener('click', () => {
        pendingMedia = null;
        if (modalInput) modalInput.textContent = '';
        if (modalCharCount) modalCharCount.textContent = `0 / ${MAX_LEN}`;
        if (modalError) modalError.textContent = '';
        if (mediaPreview) { mediaPreview.innerHTML = ''; mediaPreview.classList.add('hidden'); }
        composeModal?.classList.remove('hidden');
        setTimeout(() => modalInput?.focus(), 50);
    });

    cancelPostBtn?.addEventListener('click', closeModal);
    window.addEventListener('click', e => { if (e.target === composeModal) closeModal(); });

    function closeModal() {
        composeModal?.classList.add('hidden');
        pendingMedia = null;
    }

    modalInput?.addEventListener('input', () => {
        const len = (modalInput.textContent || '').length;
        if (modalCharCount) {
            modalCharCount.textContent = `${len} / ${MAX_LEN}`;
            modalCharCount.style.color = len > MAX_LEN ? '#e87a5a' : '';
        }
    });

    // ── Media attach (compose modal) ──────────────────────────────────────────
    fileInput?.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('file', file);
        if (modalError) modalError.textContent = 'Uploading...';
        fetch('/pug/api/upload_shared', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(data => {
                if (data.error) { if (modalError) modalError.textContent = data.error; return; }
                pendingMedia = data;
                if (modalError) modalError.textContent = '';
                renderMediaPreview(mediaPreview, data);
            })
            .catch(() => { if (modalError) modalError.textContent = 'Upload failed.'; });
        fileInput.value = '';
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
            container.innerHTML = '';
            container.classList.add('hidden');
        });
        const wrap = document.createElement('div');
        wrap.className = 'dm-media-preview-wrap';
        wrap.appendChild(el);
        wrap.appendChild(removeBtn);
        container.appendChild(wrap);
    }

    // ── Submit post ───────────────────────────────────────────────────────────
    confirmPostBtn?.addEventListener('click', submitPost);
    modalInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitPost();
    });

    function submitPost() {
        if (posting) return;
        const text = (modalInput?.textContent || '').trim();
        if (!text && !pendingMedia) {
            if (modalError) modalError.textContent = 'Write something or attach media.';
            return;
        }
        if (text.length > MAX_LEN) {
            if (modalError) modalError.textContent = 'Too long.';
            return;
        }
        posting = true;
        if (confirmPostBtn) confirmPostBtn.disabled = true;
        fetch('/pug/api/community', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, media_key: pendingMedia?.key || '' })
        })
        .then(r => r.json())
        .then(data => {
            posting = false;
            if (confirmPostBtn) confirmPostBtn.disabled = false;
            if (data.error) { if (modalError) modalError.textContent = data.error; return; }
            closeModal();
            lastPostCount = 0;
            loadFeed();
        })
        .catch(() => {
            posting = false;
            if (confirmPostBtn) confirmPostBtn.disabled = false;
        });
    }

    // ── Public profile popup ──────────────────────────────────────────────────
    const pubModal        = document.getElementById('pubProfileModal');
    const pubAvatar       = document.getElementById('pubProfileAvatar');
    const pubName         = document.getElementById('pubProfileName');
    const pubRank         = document.getElementById('pubProfileRank');
    const pubClass        = document.getElementById('pubProfileClass');
    const pubSkills       = document.getElementById('pubProfileSkills');
    const pubEmpty        = document.getElementById('pubProfileEmpty');
    const closePubProfile = document.getElementById('closePubProfileBtn');

    closePubProfile?.addEventListener('click', () => pubModal?.classList.add('hidden'));
    window.addEventListener('click', e => { if (e.target === pubModal) pubModal?.classList.add('hidden'); });

    function openProfile(uid, username) {
        if (!pubModal) return;
        pubModal.classList.remove('hidden');
        if (pubAvatar) pubAvatar.textContent = (username || '?')[0].toUpperCase();
        if (pubName)   pubName.textContent   = username;
        if (pubRank)   pubRank.textContent   = '';
        if (pubClass)  pubClass.textContent  = '';
        if (pubSkills) pubSkills.innerHTML   = '';
        if (pubEmpty)  pubEmpty.classList.add('hidden');
        fetch(`/pug/api/users/${uid}/profile`)
            .then(r => r.json())
            .then(data => {
                if (data.rank && pubRank) {
                    pubRank.textContent = data.rank;
                    pubRank.style.color = data.rank_color || '#888';
                }
                const sheet = data.sheet;
                if (!sheet) { pubEmpty?.classList.remove('hidden'); return; }
                if (pubClass && sheet.class_official) {
                    pubClass.textContent = sheet.class_official;
                }
                const skills = sheet.skills || [];
                if (!skills.length) { pubEmpty?.classList.remove('hidden'); return; }
                const _RANK_COLORS = {
                    'S+':'#ffd700','S':'#ffb700','S-':'#ffa500',
                    'A+':'#ff7c4d','A':'#ff8c42','A-':'#e8854a',
                    'B+':'#5a8fc8','B':'#4a7aaa','B-':'#4070a0',
                    'C+':'#8ac888','C':'#78b878','C-':'#68a068',
                    'D+':'#a0a0a0','D':'#888888','D-':'#707070',
                    'E':'#c06030','F':'#803010',
                };
                skills.forEach(s => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);';
                    const color = _RANK_COLORS[s.rank] || '#888';
                    const verified = s.verified !== false;
                    row.innerHTML = `
                        <span style="font-size:0.82rem;color:var(--text);">${esc(s.name)}</span>
                        <span style="font-family:var(--font-mono);font-size:0.72rem;font-weight:700;color:${verified ? color : 'var(--text-dim)'};">${verified ? s.rank : '?'}</span>`;
                    pubSkills.appendChild(row);
                });
            })
            .catch(() => { pubEmpty?.classList.remove('hidden'); });
    }

    // ── Utils ─────────────────────────────────────────────────────────────────
    function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function timeAgo(iso) {
        if (!iso) return '';
        const diff = (Date.now() - new Date(iso + 'Z')) / 1000;
        if (diff < 60)    return 'just now';
        if (diff < 3600)  return `${Math.floor(diff / 60)}m`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
        return `${Math.floor(diff / 86400)}d`;
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    loadFeed();
    setInterval(loadFeed, 15000);
});
