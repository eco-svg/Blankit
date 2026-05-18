document.addEventListener('DOMContentLoaded', () => {

    const feed         = document.getElementById('commFeed');
    const input        = document.getElementById('commInput');
    const postBtn      = document.getElementById('commPostBtn');
    const charCount    = document.getElementById('commCharCount');

    const MAX_LEN = 500;
    let lastPostCount = 0;
    let posting = false;

    // ── Feed ──────────────────────────────────────────────────────────────────
    function loadFeed() {
        fetch('/pug/api/community')
            .then(r => r.json())
            .then(posts => {
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

        const initials = (p.username || '?')[0].toUpperCase();
        const ago = timeAgo(p.created_at);
        const rankHtml = p.rank
            ? `<span class="comm-rank-badge" style="color:${p.rank_color};">${p.rank}</span>`
            : '';
        const deleteBtn = p.is_mine
            ? `<button class="comm-del-btn" data-id="${p.id}" title="Delete">×</button>`
            : '';

        el.innerHTML = `
            <div class="comm-post-header">
                <div class="comm-avatar">${initials}</div>
                <div class="comm-meta">
                    <span class="comm-username">${esc(p.username)}</span>
                    ${rankHtml}
                    <span class="comm-distro-tag">${esc(p.distro)}</span>
                </div>
                <span class="comm-ago">${ago}</span>
                ${deleteBtn}
            </div>
            <div class="comm-post-body">${esc(p.text)}</div>`;

        el.querySelector('.comm-del-btn')?.addEventListener('click', () => deletePost(p.id));
        return el;
    }

    function deletePost(id) {
        fetch(`/pug/api/community/${id}`, { method: 'DELETE' })
            .then(() => { lastPostCount = 0; loadFeed(); })
            .catch(() => {});
    }

    // ── Composer ──────────────────────────────────────────────────────────────
    input?.addEventListener('input', () => {
        const len = (input.textContent || '').length;
        if (charCount) {
            charCount.textContent = `${len} / ${MAX_LEN}`;
            charCount.style.color = len > MAX_LEN ? '#e87a5a' : '';
        }
    });

    postBtn?.addEventListener('click', submitPost);
    input?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitPost();
    });

    function submitPost() {
        if (posting) return;
        const text = (input?.textContent || '').trim();
        if (!text) return;
        if (text.length > MAX_LEN) return;
        posting = true;
        postBtn.disabled = true;
        fetch('/pug/api/community', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        })
        .then(r => r.json())
        .then(data => {
            posting = false;
            postBtn.disabled = false;
            if (data.error) return;
            if (input) input.textContent = '';
            if (charCount) charCount.textContent = `0 / ${MAX_LEN}`;
            lastPostCount = 0;
            loadFeed();
        })
        .catch(() => { posting = false; postBtn.disabled = false; });
    }

    // ── Utils ─────────────────────────────────────────────────────────────────
    function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function timeAgo(iso) {
        if (!iso) return '';
        const diff = (Date.now() - new Date(iso + 'Z')) / 1000;
        if (diff < 60)   return 'just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
        return `${Math.floor(diff / 86400)}d`;
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    loadFeed();
    setInterval(loadFeed, 15000);
});
