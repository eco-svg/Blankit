/* Profile: account settings, student status, feedback, danger zone, logout. */
(function () {
  'use strict';
  const { $, api, esc, toast, confirm } = window.Veyra;

  // ── username ───────────────────────────────────────────────
  $('#pfSaveUsername').addEventListener('click', async () => {
    const name = $('#pfUsername').value.trim();
    const msg = $('#pfUsernameMsg');
    msg.textContent = '';
    try {
      const d = await api('/pug/api/profile/username', { method: 'PATCH', body: { username: name } });
      toast('Username updated');
      window.Veyra.username = d.username;
    } catch (e) { msg.textContent = e.message; }
  });

  // ── password ───────────────────────────────────────────────
  $('#pfSavePw').addEventListener('click', async () => {
    const msg = $('#pfPwMsg');
    msg.textContent = '';
    try {
      await api('/pug/api/profile/password', { method: 'PATCH', body: {
        current: $('#pfPwCurrent').value, new: $('#pfPwNew').value } });
      $('#pfPwCurrent').value = ''; $('#pfPwNew').value = '';
      toast('Password updated');
    } catch (e) { msg.textContent = e.message; }
  });

  // ── student status ─────────────────────────────────────────
  function loadStudent() {
    api('/auth/student-status').then(d => {
      const tag = $('#studentStatusTag');
      const txt = $('#studentStatusText');
      const map = {
        approved: ['Verified student', 'ok'],
        pending:  ['Under review', 'warn'],
        rejected: ['Not verified — you can re-apply later', ''],
        none:     ['Student verification opens soon — verified students get BlinkBot free.', ''],
      };
      const [label, cls] = map[d.status] || map.none;
      txt.textContent = d.school ? `${label} · ${d.school}` : label;
      tag.textContent = d.status || 'none';
      tag.className = 'tag ' + cls;
    }).catch(() => {
      $('#studentStatusText').textContent = 'Unavailable.';
    });
  }

  // ── feedback ───────────────────────────────────────────────
  let fbKind = 'feature';
  document.querySelectorAll('#fbKind button').forEach(b => b.onclick = () => {
    fbKind = b.dataset.kind;
    document.querySelectorAll('#fbKind button').forEach(x => x.classList.toggle('active', x === b));
  });
  $('#fbSend').addEventListener('click', async () => {
    const text = $('#fbText').value.trim();
    if (!text) return;
    const msg = $('#fbMsg');
    try {
      await api('/pug/api/feedback', { method: 'POST', body: { kind: fbKind, message: text } });
      $('#fbText').value = '';
      msg.textContent = '✓ Sent — thank you!';
      setTimeout(() => { msg.textContent = ''; }, 3000);
    } catch (e) { toast(e.message, 'error'); }
  });

  // ── delete account ─────────────────────────────────────────
  $('#pfDeleteBtn').addEventListener('click', async () => {
    const pw = await confirm({
      title: 'Delete account',
      text: 'Everything — notes, goals, skills, wallet — is permanently erased. This cannot be undone. Enter your password to confirm.',
      okLabel: 'Delete forever',
      danger: true,
      withInput: { type: 'password', placeholder: 'Your password' },
    });
    if (!pw) return;
    try {
      await api('/pug/api/profile/delete', { method: 'DELETE', body: { password: pw } });
      window.location.href = '/';
    } catch (e) { toast(e.message, 'error'); }
  });

  // ── logout ─────────────────────────────────────────────────
  $('#logoutBtn').addEventListener('click', async () => {
    try {
      const d = await api('/auth/logout', { method: 'POST' });
      window.location.href = (d && d.redirect) || '/';
    } catch (_) { window.location.href = '/'; }
  });

  window.Veyra.when('profile', () => loadStudent());
})();
