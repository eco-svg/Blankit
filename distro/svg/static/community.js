/* ═══════════════════════════════════════
   community.js — live community page
   ═══════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  /* ── THEME ── */
  const saved = localStorage.getItem('ecosvg-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  /* ── STATE ── */
  let currentScope   = 'local';
  let currentSection = 'feed';
  let feedPage       = 1;
  let activePostId   = null;
  let activeCommentBase = '/api/community/posts';   // base URL for the currently-open comment thread
  // Interaction base for a post — routes to its home store (svg native, or the pug proxy).
  const postBase = p => p.source === 'pug' ? `/api/community/xpost/pug/${p.id}` : `/api/community/posts/${p.id}`;
  let selectedTag    = 'general';
  let uploadedImageUrl = null;

  /* ── HELPERS ── */
  const $  = id => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls)  e.className   = cls;
    if (text) e.textContent = text;
    return e;
  };

  function timeAgo(iso) {
    const diff = (Date.now() - new Date(iso)) / 1000;
    if (diff < 60)   return 'just now';
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400)return `${Math.floor(diff/3600)}h ago`;
    return `${Math.floor(diff/86400)}d ago`;
  }

  function showModal(id) {
    document.getElementById(id).classList.remove('hidden');
    $('modalBackdrop').classList.remove('hidden');
  }

  function hideAllModals() {
    ['postModal','commentsModal','challengeModal'].forEach(id =>
      document.getElementById(id).classList.add('hidden')
    );
    $('modalBackdrop').classList.add('hidden');
  }

  /* ── SCOPE TABS ── */
  document.querySelectorAll('.comm-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.comm-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentScope = btn.dataset.scope;
      feedPage = 1;
      loadSection(currentSection);
    });
  });

  /* ── SECTION TABS ── */
  document.querySelectorAll('.comm-section-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.comm-section-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSection = btn.dataset.section;
      feedPage = 1;
      loadSection(currentSection);
    });
  });

  function loadSection(section) {
    ['feed','leaderboard','challenges'].forEach(s => {
      document.getElementById(`section${s.charAt(0).toUpperCase()+s.slice(1)}`).classList.toggle('hidden', s !== section);
    });
    if (section === 'feed')        loadFeed(true);
    if (section === 'leaderboard') loadLeaderboard();
    if (section === 'challenges')  loadChallenges();
  }

  /* ══════════════════════════════
     FEED
  ══════════════════════════════ */
  async function loadFeed(reset = false) {
    if (reset) { feedPage = 1; $('feedList').innerHTML = '<div class="comm-loading">Loading posts…</div>'; }
    try {
      const res  = await fetch(`/api/community/posts?scope=${currentScope}&page=${feedPage}`);
      const posts = await res.json();

      if (reset) $('feedList').innerHTML = '';

      if (!posts.length && feedPage === 1) {
        $('feedList').innerHTML = '<div class="comm-empty">No posts yet — be the first to post!</div>';
        $('loadMoreBtn').style.display = 'none';
        return;
      }

      posts.forEach(p => $('feedList').appendChild(buildPostCard(p)));
      $('loadMoreBtn').style.display = posts.length < 20 ? 'none' : 'block';

    } catch { $('feedList').innerHTML = '<div class="comm-empty">Failed to load posts.</div>'; }
  }

  function buildPostCard(p) {
    const card = el('div', 'comm-post');

    const meta = el('div', 'comm-post-meta');
    meta.appendChild(el('span', 'comm-post-author', p.author));
    meta.appendChild(el('span', 'comm-post-distro', p.distro));
    const tag = el('span', 'comm-post-tag', p.tag);
    meta.appendChild(tag);
    meta.appendChild(el('span', 'comm-post-time', timeAgo(p.created_at)));
    card.appendChild(meta);

    card.appendChild(el('h3', 'comm-post-title', p.title));
    if (p.body) {
      const body = el('p', 'comm-post-body', p.body.length > 300 ? p.body.slice(0,300)+'…' : p.body);
      card.appendChild(body);
    }
    if (p.image_url) {
      const img = el('img', 'comm-post-image');
      img.src = p.image_url;
      img.loading = 'lazy';
      card.appendChild(img);
    }

    const actions = el('div', 'comm-post-actions');

    if (p.source === 'ama') {
      actions.appendChild(el('span', 'comm-post-tag', 'read-only · from Pug'));
      card.appendChild(actions);
      return card;
    }

    const voteBtn = el('button', `comm-vote-btn${p.voted ? ' voted' : ''}`, `▲ ${p.vote_count}`);
    voteBtn.addEventListener('click', async () => {
      const r = await fetch(`${postBase(p)}/vote`, {method:'POST'});
      const d = await r.json();
      p.vote_count = d.vote_count;
      p.voted      = d.voted;
      voteBtn.textContent = `▲ ${p.vote_count}`;
      voteBtn.classList.toggle('voted', p.voted);
    });
    actions.appendChild(voteBtn);

    const commentBtn = el('button', 'comm-comment-btn', `💬 ${p.comment_count}`);
    commentBtn.addEventListener('click', () => openComments(p));
    actions.appendChild(commentBtn);

    if (p.is_mine && p.source !== 'pug') {   // can't delete a foreign-distro post from here
      const delBtn = el('button', 'comm-delete-btn', '✕ delete');
      delBtn.addEventListener('click', async () => {
        if (!confirm('Delete this post?')) return;
        await fetch(`/api/community/posts/${p.id}`, {method:'DELETE'});
        card.remove();
      });
      actions.appendChild(delBtn);
    }

    card.appendChild(actions);
    return card;
  }

  $('loadMoreBtn').addEventListener('click', () => { feedPage++; loadFeed(false); });

  /* ══════════════════════════════
     LEADERBOARD
  ══════════════════════════════ */
  async function loadLeaderboard() {
    $('leaderboardList').innerHTML = '<div class="comm-loading">Loading leaderboard…</div>';
    try {
      const res   = await fetch(`/api/community/leaderboard?scope=${currentScope}`);
      const board = await res.json();
      $('leaderboardList').innerHTML = '';

      if (!board.length) {
        $('leaderboardList').innerHTML = '<div class="comm-empty">No users yet.</div>';
        return;
      }

      board.forEach((u, i) => {
        const row = el('div', `comm-lb-row${u.is_you ? ' is-you' : ''}`);

        const rankEl = el('span', 'comm-lb-rank', i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`);
        if (i === 0) rankEl.classList.add('gold');
        else if (i === 1) rankEl.classList.add('silver');
        else if (i === 2) rankEl.classList.add('bronze');
        row.appendChild(rankEl);

        const avatar = el('div', 'comm-lb-avatar', u.username.slice(0,2).toUpperCase());
        row.appendChild(avatar);

        const info = el('div', 'comm-lb-info');
        info.appendChild(el('div', 'comm-lb-username', u.username + (u.is_you ? ' (you)' : '')));
        info.appendChild(el('div', 'comm-lb-distro', u.distro));
        row.appendChild(info);

        const stats = el('div', 'comm-lb-stats');
        stats.appendChild(el('div', 'comm-lb-streak', `🔥 ${u.streak} day streak`));
        stats.appendChild(el('div', 'comm-lb-habits', `${u.habits_today} habits today`));
        row.appendChild(stats);

        $('leaderboardList').appendChild(row);
      });
    } catch { $('leaderboardList').innerHTML = '<div class="comm-empty">Failed to load leaderboard.</div>'; }
  }

  /* ══════════════════════════════
     CHALLENGES
  ══════════════════════════════ */
  async function loadChallenges() {
    $('challengesList').innerHTML = '<div class="comm-loading">Loading challenges…</div>';
    try {
      const res        = await fetch(`/api/community/challenges?scope=${currentScope}`);
      const challenges = await res.json();
      $('challengesList').innerHTML = '';

      if (!challenges.length) {
        $('challengesList').innerHTML = '<div class="comm-empty">No challenges yet — create one!</div>';
        return;
      }

      challenges.forEach(c => $('challengesList').appendChild(buildChallengeCard(c)));
    } catch { $('challengesList').innerHTML = '<div class="comm-empty">Failed to load challenges.</div>'; }
  }

  function buildChallengeCard(c) {
    const card = el('div', `comm-challenge-card${c.joined ? ' joined' : ''}`);

    const info = el('div', 'comm-challenge-info');
    info.appendChild(el('div', 'comm-challenge-title', c.title));
    info.appendChild(el('div', 'comm-challenge-meta',
      `${c.habit_name} · ${c.duration_days} days · by ${c.creator}`));
    card.appendChild(info);

    const stats = el('div', 'comm-challenge-stats');
    stats.appendChild(el('div', 'comm-challenge-members', `👥 ${c.member_count}`));
    card.appendChild(stats);

    const joinBtn = el('button', `comm-join-btn${c.joined ? ' joined' : ''}`,
      c.joined ? '✓ Joined' : 'Join');
    joinBtn.addEventListener('click', async () => {
      const r = await fetch(`/api/community/challenges/${c.id}/join`, {method:'POST'});
      const d = await r.json();
      c.joined = d.joined;
      joinBtn.textContent = c.joined ? '✓ Joined' : 'Join';
      joinBtn.classList.toggle('joined', c.joined);
      card.classList.toggle('joined', c.joined);
      const mEl = stats.querySelector('.comm-challenge-members');
      if (mEl) mEl.textContent = `👥 ${c.member_count + (c.joined ? 1 : -1)}`;
    });
    card.appendChild(joinBtn);

    return card;
  }

  /* ══════════════════════════════
     COMMENTS
  ══════════════════════════════ */
  async function openComments(post) {
    activePostId      = post.id;
    activeCommentBase = postBase(post);   // pug posts route to the cross-distro proxy
    const ttl = (post.title || post.body || '').slice(0, 40);
    $('commentsModalTitle').textContent = ttl + ((post.title || post.body || '').length > 40 ? '…' : '');
    $('commentsList').innerHTML = '<div class="comm-loading">Loading…</div>';
    showModal('commentsModal');

    const res      = await fetch(`${activeCommentBase}/comments`);
    const comments = await res.json();
    $('commentsList').innerHTML = '';

    if (!comments.length) {
      $('commentsList').innerHTML = '<div class="comm-empty">No comments yet.</div>';
      return;
    }

    comments.forEach(c => {
      const div = el('div', 'comm-comment');
      div.appendChild(el('div', 'comm-comment-author', c.author));
      div.appendChild(el('div', 'comm-comment-body', c.body));
      $('commentsList').appendChild(div);
    });
  }

  $('commentSubmit').addEventListener('click', async () => {
    const body = $('commentInput').value.trim();
    if (!body || !activePostId) return;
    const r = await fetch(`${activeCommentBase}/comments`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({body}),
    });
    if (r.ok) {
      $('commentInput').value = '';
      const div = el('div', 'comm-comment');
      div.appendChild(el('div', 'comm-comment-author', 'You'));
      div.appendChild(el('div', 'comm-comment-body', body));
      const empty = $('commentsList').querySelector('.comm-empty');
      if (empty) empty.remove();
      $('commentsList').appendChild(div);
    }
  });

  $('commentInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('commentSubmit').click(); });

  /* ══════════════════════════════
     NEW POST MODAL
  ══════════════════════════════ */
  $('newPostBtn').addEventListener('click', () => showModal('postModal'));
  $('postModalClose').addEventListener('click', hideAllModals);

  document.querySelectorAll('.comm-tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.comm-tag-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedTag = btn.dataset.tag;
    });
  });

  $('postBody').addEventListener('input', () => {
    $('bodyCount').textContent = $('postBody').value.length;
  });

  /* ── IMAGE UPLOAD ── */
  $('postImageBtn').addEventListener('click', () => $('postImageInput').click());

  $('postImageInput').addEventListener('change', async () => {
    const file = $('postImageInput').files[0];
    if (!file) return;

    $('postImageStatus').textContent = 'Checking image…';
    uploadedImageUrl = null;
    $('postImagePreview').classList.add('hidden');

    const formData = new FormData();
    formData.append('image', file);

    try {
      const r = await fetch('/api/community/upload-image', { method: 'POST', body: formData });
      const d = await r.json();
      if (r.ok) {
        uploadedImageUrl = d.url;
        $('postImagePreview').src = d.url;
        $('postImagePreview').classList.remove('hidden');
        $('postImageStatus').textContent = '✓ Image attached';
      } else {
        $('postImageStatus').textContent = `✗ ${d.error || 'upload failed'}`;
        $('postImageInput').value = '';
      }
    } catch {
      $('postImageStatus').textContent = '✗ Upload failed';
    }
  });

  $('postSubmit').addEventListener('click', async () => {
    const title = $('postTitle').value.trim();
    const body  = $('postBody').value.trim();
    if (!title || !body) { alert('Title and body are required.'); return; }

    const r = await fetch('/api/community/posts', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({title, body, tag: selectedTag, image_url: uploadedImageUrl,
                            is_global: !!$('postAllDistros')?.checked}),
    });

    if (r.ok) {
      hideAllModals();
      $('postTitle').value = '';
      $('postBody').value  = '';
      $('bodyCount').textContent = '0';
      $('postImageInput').value = '';
      $('postImagePreview').classList.add('hidden');
      $('postImageStatus').textContent = '';
      uploadedImageUrl = null;
      feedPage = 1;
      // Switch to feed section
      document.querySelectorAll('.comm-section-tab').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-section="feed"]').classList.add('active');
      currentSection = 'feed';
      loadSection('feed');
    } else {
      const d = await r.json();
      alert(d.error || 'Failed to post.');
    }
  });

  /* ══════════════════════════════
     NEW CHALLENGE MODAL
  ══════════════════════════════ */
  $('newChallengeBtn').addEventListener('click', () => showModal('challengeModal'));
  $('challengeModalClose').addEventListener('click', hideAllModals);

  $('challengeSubmit').addEventListener('click', async () => {
    const title      = $('challengeTitle').value.trim();
    const habit_name = $('challengeHabit').value.trim();
    const duration   = parseInt($('challengeDuration').value);
    const scope      = $('challengeScope').value;

    if (!title || !habit_name) { alert('Title and habit name required.'); return; }

    const r = await fetch('/api/community/challenges', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({title, habit_name, duration_days: duration, scope}),
    });

    if (r.ok) {
      hideAllModals();
      $('challengeTitle').value = '';
      $('challengeHabit').value = '';
      loadChallenges();
    } else {
      const d = await r.json();
      alert(d.error || 'Failed to create challenge.');
    }
  });

  /* ── CLOSE ON BACKDROP ── */
  $('modalBackdrop').addEventListener('click', hideAllModals);
  $('commentsModalClose').addEventListener('click', hideAllModals);

  /* ── INITIAL LOAD ── */
  loadSection('feed');
});