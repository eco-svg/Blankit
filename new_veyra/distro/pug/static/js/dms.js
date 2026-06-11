/* Direct messages: threads, chat, media, unread badges, notif rendering. */
(function () {
  'use strict';
  const { $, api, esc, toast, timeAgo } = window.Veyra;

  let activePeer = null;
  let pollTimer = null;

  function setBadge(count) {
    ['#dmBadge', '#dmBadgeM'].forEach(sel => {
      const b = $(sel);
      if (!b) return;
      b.textContent = count > 9 ? '9+' : count;
      b.classList.toggle('show', count > 0);
    });
  }

  async function loadThreads() {
    try {
      const threads = await api('/pug/api/dms');
      const wrap = $('#dmThreads');
      wrap.innerHTML = '';
      let unreadTotal = 0;
      if (!threads.length) wrap.innerHTML = '<div class="empty">No conversations yet — find people in Community.</div>';
      threads.forEach(t => {
        unreadTotal += t.unread_count || 0;
        const el = document.createElement('div');
        el.className = 'dm-thread-item' + (activePeer && activePeer.id === t.other_id ? ' active' : '');
        el.innerHTML = `
          <div class="avatar">${esc(t.username[0].toUpperCase())}
            <span class="presence ${t.is_online ? 'online' : ''}"></span></div>
          <div class="row-main">
            <div class="row-title">${esc(t.username)}</div>
            <div class="dm-last">${esc(t.last_msg || '')}</div>
          </div>
          <div style="text-align:right">
            <div class="muted" style="font-size:0.66rem">${timeAgo(t.last_time)}</div>
            ${t.unread_count ? `<span class="unread-dot">${t.unread_count}</span>` : ''}
          </div>`;
        el.onclick = () => openThread(t.other_id, t.username, t.is_online);
        wrap.appendChild(el);
      });
      setBadge(unreadTotal);
    } catch (_) {}
  }

  function renderMessage(m) {
    const el = document.createElement('div');
    el.className = 'bubble ' + (m.is_mine ? 'mine' : 'theirs');
    let inner = '';
    const body = m.body || '';
    // Comment-notification convention: §§NOTIF§§head§§END§§body
    if (body.startsWith('§§NOTIF§§')) {
      const head = body.slice(9, body.indexOf('§§END§§'));
      const rest = body.slice(body.indexOf('§§END§§') + 7);
      inner = `<span class="notif-head">${esc(head)}</span>${esc(rest)}`;
    } else {
      inner = esc(body);
    }
    if (m.media_url) {
      const url = esc(m.media_url);
      if (/\.(mp4|webm)$/i.test(m.media_key || ''))            inner += `<video src="${url}" controls preload="metadata"></video>`;
      else if (/\.(mp3|wav|ogg|m4a|flac)$/i.test(m.media_key || '')) inner += `<audio src="${url}" controls></audio>`;
      else inner += `<img src="${url}" loading="lazy" alt="">`;
    }
    el.innerHTML = inner;
    return el;
  }

  async function loadMessages() {
    if (!activePeer) return;
    try {
      const msgs = await api(`/pug/api/dms/${activePeer.id}`);
      const scroll = $('#dmScroll');
      const atBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 60;
      scroll.innerHTML = '';
      msgs.forEach(m => scroll.appendChild(renderMessage(m)));
      if (atBottom || !scroll.dataset.loaded) scroll.scrollTop = scroll.scrollHeight;
      scroll.dataset.loaded = '1';
      await api(`/pug/api/dms/${activePeer.id}/read`, { method: 'PATCH' });
      loadThreads();
    } catch (_) {}
  }

  function openThread(uid, username, online) {
    activePeer = { id: uid, name: username };
    $('#dmChat').classList.remove('hidden');
    $('#dmPlaceholder').classList.add('hidden');
    $('#dmThreads').classList.add('hide-mobile');
    $('#dmPeerName').textContent = username;
    $('#dmPeerAvatar').textContent = username[0].toUpperCase();
    $('#dmPeerStatus').textContent = online ? 'online' : '';
    $('#dmScroll').dataset.loaded = '';
    loadMessages();
  }

  // Open a DM from anywhere (community action buttons, profiles)
  window.Veyra.openDm = function (uid, username) {
    window.Veyra.navigate('messages');
    openThread(uid, username, false);
  };

  $('#dmBack').addEventListener('click', () => {
    $('#dmChat').classList.add('hidden');
    $('#dmPlaceholder').classList.remove('hidden');
    $('#dmThreads').classList.remove('hide-mobile');
    activePeer = null;
  });

  let sending = false;
  async function send(mediaKey) {
    if (!activePeer || sending) return;
    const input = $('#dmInput');
    const body = input.value.trim();
    if (!body && !mediaKey) return;
    sending = true;
    try {
      await api(`/pug/api/dms/${activePeer.id}`, { method: 'POST',
        body: { body, media_key: mediaKey || '' } });
      input.value = '';
      loadMessages();
    } catch (e) { toast(e.message, 'error'); }
    sending = false;
  }
  $('#dmSend').addEventListener('click', () => send());
  $('#dmInput').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

  $('#dmMedia').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f || !activePeer) return;
    try {
      const fd = new FormData();
      fd.append('file', f);
      const d = await api('/pug/api/upload_shared', { method: 'POST', body: fd });
      await send(d.key);
    } catch (err) { toast(err.message, 'error'); }
    e.target.value = '';
  });

  window.Veyra.when('messages', () => {
    loadThreads();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const active = document.querySelector('.view[data-view="messages"]').classList.contains('active');
      if (active) { loadThreads(); if (activePeer) loadMessages(); }
    }, 12000);
  });

  // global unread poll (any tab)
  loadThreads();
  setInterval(() => { if (document.visibilityState === 'visible') loadThreads(); }, 60000);
})();
