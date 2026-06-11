/* Ask: AMA (human-answered) + quick AI answers + admin inbox. */
(function () {
  'use strict';
  const { $, api, esc, toast, timeAgo } = window.Veyra;

  // ── AMA ────────────────────────────────────────────────────
  function bubble(text, mine) {
    const el = document.createElement('div');
    el.className = 'bubble ' + (mine ? 'mine' : 'theirs');
    el.textContent = text;
    return el;
  }

  async function loadAma() {
    try {
      const d = await api('/pug/api/ama');
      const wrap = $('#amaThread');
      wrap.innerHTML = '';
      if (!d.messages.length) wrap.innerHTML = '<div class="empty">Ask the team anything — product, skills, the platform.</div>';
      d.messages.forEach(m => wrap.appendChild(bubble(m.body, !m.is_admin)));
      wrap.scrollTop = wrap.scrollHeight;
      const free = Math.max(0, 1 - d.today_count);
      $('#amaQuota').textContent = free ? `${free} free today` : `extras cost 1 Eye · balance ${d.balance}`;
    } catch (_) {}
  }

  let amaBusy = false;
  async function amaSend() {
    if (amaBusy) return;
    const input = $('#amaInput');
    const text = input.value.trim();
    if (!text) return;
    amaBusy = true;
    $('#amaError').textContent = '';
    try {
      await api('/pug/api/ama', { method: 'POST', body: { text } });
      input.value = '';
      loadAma();
    } catch (e) {
      $('#amaError').textContent = e.data && e.data.message ? e.data.message : e.message;
    }
    amaBusy = false;
  }
  $('#amaSend').addEventListener('click', amaSend);
  $('#amaInput').addEventListener('keydown', e => { if (e.key === 'Enter') amaSend(); });

  // ── quick AI ───────────────────────────────────────────────
  let askBusy = false;
  async function askSend() {
    if (askBusy) return;
    const input = $('#askInput');
    const q = input.value.trim();
    if (!q) return;
    askBusy = true;
    const wrap = $('#askThread');
    wrap.appendChild(bubble(q, true));
    const thinking = bubble('…', false);
    wrap.appendChild(thinking);
    wrap.scrollTop = wrap.scrollHeight;
    input.value = '';
    try {
      const d = await api('/pug/api/ask', { method: 'POST', body: { query: q } });
      thinking.textContent = d.answer || 'No answer.';
    } catch (e) {
      thinking.textContent = e.message;
    }
    wrap.scrollTop = wrap.scrollHeight;
    askBusy = false;
  }
  $('#askSend').addEventListener('click', askSend);
  $('#askInput').addEventListener('keydown', e => { if (e.key === 'Enter') askSend(); });

  // ── admin inbox ────────────────────────────────────────────
  let adminUid = null;

  async function loadAdminInbox() {
    if (!window.Veyra.isAdmin || !$('#adminAmaUsers')) return;
    try {
      const users = await api('/pug/api/admin/ama');
      const wrap = $('#adminAmaUsers');
      wrap.innerHTML = users.length ? '' : '<div class="empty">No questions yet.</div>';
      users.forEach(u => {
        const row = document.createElement('div');
        row.className = 'row-item';
        row.style.cursor = 'pointer';
        row.innerHTML = `
          <div class="row-main">
            <div class="row-title">${esc(u.username)} ${u.is_admin_last ? '' : '<span class="tag warn">awaiting</span>'}</div>
            <div class="row-sub">${esc(u.preview)} · ${timeAgo(u.last_at)}</div>
          </div>`;
        row.onclick = () => openAdminThread(u.user_id);
        wrap.appendChild(row);
      });
    } catch (_) {}
  }

  async function openAdminThread(uid) {
    adminUid = uid;
    try {
      const d = await api(`/pug/api/admin/ama/${uid}`);
      const wrap = $('#adminAmaThread');
      wrap.innerHTML = '';
      d.messages.forEach(m => wrap.appendChild(bubble(m.body, m.is_admin)));
      wrap.scrollTop = wrap.scrollHeight;
      $('#adminReplyRow').classList.remove('hidden');
    } catch (e) { toast(e.message, 'error'); }
  }

  if (window.Veyra.isAdmin) {
    const sendBtn = $('#adminReplySend');
    if (sendBtn) {
      const reply = async () => {
        const input = $('#adminReplyInput');
        const text = input.value.trim();
        if (!text || !adminUid) return;
        try {
          await api(`/pug/api/admin/ama/${adminUid}/reply`, { method: 'POST', body: { text } });
          input.value = '';
          openAdminThread(adminUid);
          loadAdminInbox();
        } catch (e) { toast(e.message, 'error'); }
      };
      sendBtn.addEventListener('click', reply);
      $('#adminReplyInput').addEventListener('keydown', e => { if (e.key === 'Enter') reply(); });
    }
  }

  window.Veyra.when('ask', () => { loadAma(); loadAdminInbox(); });
})();
