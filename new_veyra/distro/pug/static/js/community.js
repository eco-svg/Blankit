/* Community: feed, composer, reactions, comments, actions, profiles, search. */
(function () {
  'use strict';
  const { $, api, esc, toast, modal, closeModal, confirm, timeAgo, debounce } = window.Veyra;

  let postType = '';
  let mediaKey = '';
  let pollTimer = null;

  // ── composer ───────────────────────────────────────────────
  $('#postTypePick').addEventListener('click', e => {
    const pill = e.target.closest('.pt-pill');
    if (!pill) return;
    postType = (postType === pill.dataset.pt) ? '' : pill.dataset.pt;
    document.querySelectorAll('#postTypePick .pt-pill').forEach(p =>
      p.classList.toggle('active', p.dataset.pt === postType));
  });

  $('#postMedia').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    $('#postMediaName').textContent = 'Uploading…';
    try {
      const fd = new FormData();
      fd.append('file', f);
      const d = await api('/pug/api/upload_shared', { method: 'POST', body: fd });
      mediaKey = d.key;
      $('#postMediaName').textContent = '📎 ' + f.name;
    } catch (err) {
      mediaKey = '';
      $('#postMediaName').textContent = '';
      toast(err.message, 'error');
    }
  });

  let publishing = false;
  $('#publishBtn').addEventListener('click', async () => {
    if (publishing) return;
    const text = $('#postText').value.trim();
    const errEl = $('#postError');
    errEl.textContent = '';
    if (!text && !mediaKey) { errEl.textContent = 'Write something or attach media.'; return; }
    publishing = true;
    const btn = $('#publishBtn');
    btn.disabled = true;
    try {
      await api('/pug/api/community', { method: 'POST', body: {
        text, media_key: mediaKey, post_type: postType,
        skill_tag: $('#postSkillTag').value || '',
      }});
      $('#postText').value = '';
      $('#postMediaName').textContent = '';
      mediaKey = ''; postType = '';
      document.querySelectorAll('#postTypePick .pt-pill').forEach(p => p.classList.remove('active'));
      toast('Posted');
      loadFeed();
    } catch (e) { errEl.textContent = e.message; }
    publishing = false;
    btn.disabled = false;
  });

  // ── feed ───────────────────────────────────────────────────
  function postCard(p) {
    const card = document.createElement('div');
    card.className = 'card post';
    card.dataset.pid = p.id;
    const rank = p.rank
      ? `<span class="rank-badge sm" style="color:${esc(p.rank_color)};border-color:${esc(p.rank_color)}">${esc(p.rank)}</span>` : '';
    const dist = (p.dist_km != null) ? `<span class="tag">${p.dist_km} km</span>` : '';
    const ptype = p.post_type ? `<span class="tag accent">${esc(p.post_type)}</span>` : '';
    const skill = p.skill_tag ? `<span class="tag">#${esc(p.skill_tag)}</span>` : '';
    let media = '';
    if (p.media_url) {
      const url = esc(p.media_url);
      if (/\.(mp4|webm|mov|avi)$/i.test(p.media_key || ''))      media = `<div class="post-media"><video src="${url}" controls preload="metadata"></video></div>`;
      else if (/\.(mp3|wav|ogg|m4a|flac)$/i.test(p.media_key || '')) media = `<div class="post-media"><audio src="${url}" controls></audio></div>`;
      else media = `<div class="post-media"><img src="${url}" loading="lazy" alt=""></div>`;
    }
    const textHtml = p.text ? `<div class="post-text">${esc(p.text)}</div>` : '';
    const bodyHtml = (p.text_order === 'mt') ? media + textHtml : textHtml + media;

    const actions = (!p.is_mine && p.post_type && ['sell', 'teach', 'hire', 'collab', 'showoff'].includes(p.post_type))
      ? `<button class="action-btn" data-act="${p.post_type === 'sell' ? 'buy' : p.post_type === 'teach' ? 'learn' : p.post_type === 'showoff' ? 'collab' : p.post_type}">
           ${p.post_type === 'sell' ? 'Buy' : p.post_type === 'teach' ? 'Learn' : p.post_type === 'hire' ? 'Apply' : 'Collab'}
         </button>` : '';

    card.innerHTML = `
      <div class="post-head">
        <div class="avatar">${esc((p.username || '?')[0].toUpperCase())}
          <span class="presence ${p.is_online ? 'online' : ''}"></span></div>
        <div style="min-width:0">
          <span class="post-author" data-uid="${p.user_id}">${esc(p.username)}</span> ${rank}
          <div class="post-meta">${timeAgo(p.created_at)} ${ptype} ${skill} ${dist}</div>
        </div>
        <div class="spacer" style="flex:1"></div>
        ${p.is_mine ? '<button class="icon-btn danger" data-del title="Delete post">✕</button>' : ''}
      </div>
      ${bodyHtml}
      <div class="post-foot">
        <button class="react-btn ${p.my_reaction === 'like' ? 'on' : ''}" data-react="like">▲ <span>${p.likes || 0}</span></button>
        <button class="react-btn ${p.my_reaction === 'dislike' ? 'on' : ''}" data-react="dislike">▼ <span>${p.dislikes || 0}</span></button>
        <button class="react-btn" data-comments>💬 <span>${p.comment_count || 0}</span></button>
        ${actions}
        <button class="react-btn" data-share title="Copy link">↗ Share</button>
      </div>
      <div class="comments hidden"></div>`;

    // reactions
    card.querySelectorAll('[data-react]').forEach(b => b.onclick = async () => {
      try {
        const d = await api(`/pug/api/community/${p.id}/react`, { method: 'POST', body: { type: b.dataset.react } });
        const [likeBtn, disBtn] = card.querySelectorAll('[data-react]');
        likeBtn.querySelector('span').textContent = d.likes;
        disBtn.querySelector('span').textContent = d.dislikes;
        likeBtn.classList.toggle('on', d.my_reaction === 'like');
        disBtn.classList.toggle('on', d.my_reaction === 'dislike');
      } catch (e) { toast(e.message, 'error'); }
    });

    // delete
    const del = card.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      if (!await confirm({ title: 'Delete post?', text: 'It will disappear from the feed.', okLabel: 'Delete', danger: true })) return;
      await api(`/pug/api/community/${p.id}`, { method: 'DELETE' });
      card.remove();
    };

    // share
    card.querySelector('[data-share]').onclick = () => {
      navigator.clipboard.writeText(`${location.origin}/pug/home#community-${p.id}`)
        .then(() => toast('Link copied'));
    };

    // action buttons (Buy/Learn/Apply/Collab) → EXP + DM the author
    const actBtn = card.querySelector('[data-act]');
    if (actBtn) actBtn.onclick = async () => {
      try {
        await api(`/pug/api/community/${p.id}/action`, { method: 'POST', body: { action: actBtn.dataset.act } });
        toast('Sent! Continue in their DMs.');
        window.Veyra.openDm && window.Veyra.openDm(p.user_id, p.username);
      } catch (e) { toast(e.message, 'error'); }
    };

    // profile popup
    card.querySelector('.post-author').onclick = () => openProfile(p.user_id);

    // comments
    card.querySelector('[data-comments]').onclick = () => toggleComments(card, p);
    return card;
  }

  async function toggleComments(card, p) {
    const box = card.querySelector('.comments');
    if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = '<span class="spin"></span>';
    await renderComments(box, p);
  }

  async function renderComments(box, p) {
    try {
      const comments = await api(`/pug/api/community/${p.id}/comments`);
      box.innerHTML = '';
      comments.forEach(c => {
        const el = document.createElement('div');
        el.className = 'comment';
        el.innerHTML = `
          <div class="avatar" style="width:26px;height:26px;font-size:0.7rem">${esc((c.username || '?')[0].toUpperCase())}</div>
          <div class="comment-body">
            <span class="comment-author">${esc(c.username)}</span>
            ${c.is_pinned ? '<span class="pin-flag">📌 pinned</span>' : ''}
            <div class="comment-text">${esc(c.text)}</div>
            <div class="comment-meta">
              <button class="${c.my_reaction === 'like' ? 'on' : ''}" data-cr="like">▲ ${c.likes}</button>
              <button class="${c.my_reaction === 'dislike' ? 'on' : ''}" data-cr="dislike">▼ ${c.dislikes}</button>
              ${c.can_pin ? `<button data-pin>${c.is_pinned ? 'Unpin' : 'Pin'}</button>` : ''}
              <span class="muted" style="font-size:0.68rem">${timeAgo(c.created_at)}</span>
            </div>
          </div>`;
        el.querySelectorAll('[data-cr]').forEach(b => b.onclick = async () => {
          await api(`/pug/api/community/${p.id}/comment/${c.id}/react`, { method: 'POST', body: { type: b.dataset.cr } });
          renderComments(box, p);
        });
        const pin = el.querySelector('[data-pin]');
        if (pin) pin.onclick = async () => {
          await api(`/pug/api/community/${p.id}/comment/${c.id}/pin`, { method: 'POST' });
          renderComments(box, p);
        };
        box.appendChild(el);
      });
      const compose = document.createElement('div');
      compose.className = 'field-row mt-8';
      compose.innerHTML = `
        <input class="input" placeholder="Comment…" maxlength="300">
        <button class="btn sm">Reply</button>`;
      const input = compose.querySelector('input');
      const send = async () => {
        const text = input.value.trim();
        if (!text) return;
        try {
          await api(`/pug/api/community/${p.id}/comment`, { method: 'POST', body: { text } });
          renderComments(box, p);
        } catch (e) { toast(e.message, 'error'); }
      };
      compose.querySelector('button').onclick = send;
      input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
      box.appendChild(compose);
    } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  async function loadFeed() {
    const geo = window.Veyra.geo;
    const qs = geo ? `?lat=${geo.lat}&lng=${geo.lng}` : '';
    try {
      const d = await api('/pug/api/community' + qs);
      const feed = $('#feed');
      feed.innerHTML = '';
      (d.posts || []).forEach(p => feed.appendChild(postCard(p)));
      $('#feedEmpty').classList.toggle('hidden', (d.posts || []).length > 0);
      $('#feedRadius').textContent = d.radius_km ? `within ${d.radius_km} km` : 'everywhere';
    } catch (e) { /* ignore */ }
  }

  // ── profile popup ──────────────────────────────────────────
  async function openProfile(uid) {
    try {
      const u = await api(`/pug/api/users/${uid}/profile`);
      const skills = ((u.sheet && u.sheet.skills) || []).slice(0, 6).map(sk =>
        `<span class="tag ${sk.verified !== false ? 'accent' : ''}">${esc(sk.name)} · ${esc(sk.rank || '?')}</span>`).join(' ');
      const m = modal(`
        <div class="flex mb-12">
          <div class="avatar lg">${esc((u.username || '?')[0].toUpperCase())}
            <span class="presence ${u.is_online ? 'online' : ''}"></span></div>
          <div>
            <h3 style="margin:0">${esc(u.username)}
              ${u.rank ? `<span class="rank-badge sm" style="color:${esc(u.rank_color)};border-color:${esc(u.rank_color)}">${esc(u.rank)}</span>` : ''}
            </h3>
            <div class="muted" style="font-size:0.78rem">
              ${u.sheet && u.sheet.class_official ? esc(u.sheet.class_official) + ' · ' : ''}${u.connections || 0} connections
            </div>
          </div>
        </div>
        ${skills ? `<div class="mb-12">${skills}</div>` : '<div class="empty">No stats yet.</div>'}
        <div class="modal-actions" style="justify-content:flex-start">
          <button class="btn" id="ppDm">Message</button>
          <button class="btn ghost" id="ppClose">Close</button>
        </div>`);
      $('#ppDm', m).onclick = () => { closeModal(); window.Veyra.openDm && window.Veyra.openDm(uid, u.username); };
      $('#ppClose', m).onclick = closeModal;
    } catch (e) { toast(e.message, 'error'); }
  }
  window.Veyra.openProfile = openProfile;

  // ── user search ────────────────────────────────────────────
  $('#userSearch').addEventListener('input', debounce(async () => {
    const q = $('#userSearch').value.trim();
    const box = $('#userSearchResults');
    if (q.length < 2) { box.classList.add('hidden'); return; }
    try {
      const users = await api('/pug/api/users/search?q=' + encodeURIComponent(q));
      box.classList.remove('hidden');
      box.innerHTML = users.length ? '' : '<div class="empty">No matches.</div>';
      users.forEach(u => {
        const row = document.createElement('div');
        row.className = 'row-item';
        row.style.cursor = 'pointer';
        row.innerHTML = `
          <div class="avatar">${esc(u.username[0].toUpperCase())}
            <span class="presence ${u.is_online ? 'online' : ''}"></span></div>
          <div class="row-main"><div class="row-title">${esc(u.username)}</div></div>
          ${u.rank ? `<span class="rank-badge sm" style="color:${esc(u.rank_color)};border-color:${esc(u.rank_color)}">${esc(u.rank)}</span>` : ''}`;
        row.onclick = () => openProfile(u.id);
        box.appendChild(row);
      });
    } catch (_) {}
  }, 300));

  window.Veyra.when('community', () => {
    loadFeed();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible' &&
          document.querySelector('.view[data-view="community"]').classList.contains('active')) {
        loadFeed();
      }
    }, 45000);
  });
})();
