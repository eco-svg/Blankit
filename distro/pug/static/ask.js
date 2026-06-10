// Ask Anything (AMA) — user-facing + admin inbox

(function () {
  // ── User-facing chat ──────────────────────────────────────────────────────

  const flipInner  = document.getElementById('amaFlipInner');
  const openBtn    = document.getElementById('amaOpenBtn');
  const backBtn    = document.getElementById('amaBackBtn');
  const chatWindow = document.getElementById('amaChatWindow');
  const emptyState = document.getElementById('amaEmptyState');
  const awaiting   = document.getElementById('amaAwaiting');
  const quotaPill  = document.getElementById('amaQuotaPill');
  const input      = document.getElementById('amaInput');
  const sendBtn    = document.getElementById('amaSendBtn');

  let _pollTimer = null;

  function _tsLabel(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function _renderMessages(msgs, todayCount, balance) {
    chatWindow.querySelectorAll('.ama-bubble').forEach(el => el.remove());
    if (emptyState) emptyState.style.display = msgs.length ? 'none' : '';

    msgs.forEach(m => {
      const div = document.createElement('div');
      div.className = 'ama-bubble ' + (m.is_admin ? 'from-admin' : 'from-user');
      div.innerHTML = `<div class="bubble-body">${_escHtml(m.body)}</div>
        <div class="bubble-meta">${_tsLabel(m.created_at)}</div>`;
      chatWindow.appendChild(div);
    });

    chatWindow.scrollTop = chatWindow.scrollHeight;

    // Awaiting indicator — show if last message is from user
    if (awaiting) {
      const last = msgs[msgs.length - 1];
      awaiting.style.display = (last && !last.is_admin) ? '' : 'none';
    }

    // Quota pill
    if (quotaPill) {
      if (todayCount >= 1) {
        quotaPill.textContent = `${balance} Eye${balance !== 1 ? 's' : ''} left`;
        quotaPill.className = 'ask-quota-pill ask-quota-paid';
      } else {
        quotaPill.textContent = 'Free today';
        quotaPill.className = 'ask-quota-pill ask-quota-free';
      }
    }
  }

  async function _loadMessages() {
    try {
      const res  = await fetch('/pug/api/ama');
      if (!res.ok) return;
      const data = await res.json();
      _renderMessages(data.messages || [], data.today_count || 0, data.balance || 0);
    } catch (_) {}
  }

  function _startPoll() {
    _stopPoll();
    _pollTimer = setInterval(_loadMessages, 60000);
  }

  function _stopPoll() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (flipInner) flipInner.classList.add('flipped');
      _loadMessages();
      _startPoll();
    });
  }

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (flipInner) flipInner.classList.remove('flipped');
      _stopPoll();
    });
  }

  if (input) {
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _send(); }
    });
  }

  if (sendBtn) sendBtn.addEventListener('click', _send);

  async function _send() {
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    sendBtn.disabled = true;
    input.disabled   = true;

    try {
      const res  = await fetch('/pug/api/ama', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text }),
      });
      const data = await res.json();

      if (res.status === 402) {
        _showError(data.message || 'Not enough Eyes.');
      } else if (!res.ok) {
        _showError(data.error || 'Something went wrong.');
      } else {
        input.value = '';
        input.style.height = 'auto';
        _loadMessages();
      }
    } catch (_) {
      _showError('Connection failed.');
    } finally {
      sendBtn.disabled = false;
      input.disabled   = false;
      input.focus();
    }
  }

  function _showError(msg) {
    const el = document.createElement('div');
    el.className = 'ama-error-toast';
    el.textContent = msg;
    chatWindow.appendChild(el);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    setTimeout(() => el.remove(), 4000);
  }

  function _escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/\n/g, '<br>');
  }

  // Re-load when navigating to buddybot tab
  document.addEventListener('veyra:navigate', e => {
    if (e.detail?.route === 'buddybot') {
      _loadMessages();
      _startPoll();
    } else {
      _stopPoll();
    }
  });


  // ── Admin inbox ────────────────────────────────────────────────────────────

  const adminUsers     = document.getElementById('adminAmaUsers');
  const adminThread    = document.getElementById('adminAmaThread');
  const adminRefresh   = document.getElementById('adminAmaRefresh');

  if (!adminUsers) return; // non-admin user, stop here

  let _activeUid = null;

  async function loadAdminList() {
    try {
      const res  = await fetch('/pug/api/admin/ama');
      if (!res.ok) return;
      const list = await res.json();
      adminUsers.innerHTML = '';

      if (!list.length) {
        adminUsers.innerHTML = '<div class="admin-ama-empty-users">No questions yet.</div>';
        return;
      }

      list.forEach(u => {
        const row = document.createElement('div');
        row.className = 'admin-ama-user-row' + (u.user_id === _activeUid ? ' active' : '');
        row.dataset.uid = u.user_id;
        row.innerHTML = `<div class="admin-ama-user-name">${_escHtml(u.username)}</div>
          <div class="admin-ama-user-preview">${_escHtml(u.preview)}</div>`;
        row.addEventListener('click', () => loadThread(u.user_id, u.username));
        adminUsers.appendChild(row);
      });
    } catch (_) {}
  }

  async function loadThread(uid, username) {
    _activeUid = uid;
    adminUsers.querySelectorAll('.admin-ama-user-row').forEach(r => {
      r.classList.toggle('active', parseInt(r.dataset.uid) === uid);
    });

    try {
      const res  = await fetch(`/pug/api/admin/ama/${uid}`);
      if (!res.ok) return;
      const data = await res.json();

      adminThread.innerHTML = '';

      const header = document.createElement('div');
      header.className = 'admin-thread-header';
      header.textContent = data.username || username;
      adminThread.appendChild(header);

      const msgs = document.createElement('div');
      msgs.className = 'admin-thread-messages';
      (data.messages || []).forEach(m => {
        const b = document.createElement('div');
        b.className = 'ama-bubble ' + (m.is_admin ? 'from-admin' : 'from-user');
        b.innerHTML = `<div class="bubble-body">${_escHtml(m.body)}</div>
          <div class="bubble-meta">${_tsLabel(m.created_at)}</div>`;
        msgs.appendChild(b);
      });
      adminThread.appendChild(msgs);
      msgs.scrollTop = msgs.scrollHeight;

      const replyRow = document.createElement('div');
      replyRow.className = 'admin-reply-row';
      replyRow.innerHTML = `<textarea class="ama-textarea admin-reply-input" placeholder="Type your reply..." rows="1" maxlength="2000"></textarea>
        <button class="ama-send-btn admin-reply-send">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>`;
      adminThread.appendChild(replyRow);

      const replyInput = replyRow.querySelector('.admin-reply-input');
      const replySend  = replyRow.querySelector('.admin-reply-send');

      replyInput.addEventListener('input', () => {
        replyInput.style.height = 'auto';
        replyInput.style.height = Math.min(replyInput.scrollHeight, 100) + 'px';
      });
      replyInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(uid, replyInput, replySend, msgs); }
      });
      replySend.addEventListener('click', () => sendReply(uid, replyInput, replySend, msgs));

    } catch (_) {}
  }

  async function sendReply(uid, input, btn, msgContainer) {
    const text = input.value.trim();
    if (!text) return;
    btn.disabled   = true;
    input.disabled = true;
    try {
      const res = await fetch(`/pug/api/admin/ama/${uid}/reply`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text }),
      });
      if (res.ok) {
        const data = await res.json();
        input.value = '';
        input.style.height = 'auto';
        const b = document.createElement('div');
        b.className = 'ama-bubble from-admin';
        b.innerHTML = `<div class="bubble-body">${_escHtml(text)}</div>
          <div class="bubble-meta">just now</div>`;
        msgContainer.appendChild(b);
        msgContainer.scrollTop = msgContainer.scrollHeight;
      }
    } catch (_) {}
    btn.disabled   = false;
    input.disabled = false;
    input.focus();
  }

  if (adminRefresh) adminRefresh.addEventListener('click', () => {
    loadAdminList();
    if (_activeUid) loadThread(_activeUid);
  });

  document.addEventListener('veyra:navigate', e => {
    if (e.detail?.route === 'admin') loadAdminList();
  });

})();
