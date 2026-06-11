/* Notes: grid, search, editor modal. */
(function () {
  'use strict';
  const { $, api, esc, toast, modal, closeModal, confirm, debounce } = window.Veyra;

  let notes = [];

  function render() {
    const q = ($('#noteSearch').value || '').toLowerCase();
    const grid = $('#noteGrid');
    grid.innerHTML = '';
    const visible = notes.filter(n =>
      !q || (n.title || '').toLowerCase().includes(q) || (n.body || '').toLowerCase().includes(q));
    $('#notesCount').textContent = notes.length ? `${notes.length} total` : '';
    $('#notesEmpty').classList.toggle('hidden', visible.length > 0);
    visible.forEach(n => {
      const card = document.createElement('div');
      card.className = 'card note-card';
      const date = n.updated_at ? new Date(n.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
      card.innerHTML = `
        <div class="nt">${esc(n.title || 'Untitled')}</div>
        <div class="nb">${esc(n.body || '')}</div>
        <div class="nd">${esc(date)}${n.start_datetime ? ' · 📅 ' + esc(n.start_datetime.slice(0, 10)) : ''}</div>`;
      card.onclick = () => openEditor(n);
      grid.appendChild(card);
    });
  }

  function load() {
    api('/pug/api/notes').then(d => { notes = d; render(); }).catch(() => {});
  }

  function openEditor(n) {
    const m = modal(`
      <h3>${n ? 'Edit note' : 'New note'}</h3>
      <div class="field"><input class="input" id="neTitle" placeholder="Title" maxlength="500" value="${esc(n ? n.title : '')}"></div>
      <div class="field"><textarea class="textarea" id="neBody" rows="9" placeholder="Write…">${esc(n ? n.body : '')}</textarea></div>
      <div class="field">
        <label>Calendar date (optional)</label>
        <input class="input" id="neDate" type="date" value="${n && n.start_datetime ? n.start_datetime.slice(0, 10) : ''}">
      </div>
      <div class="modal-actions" style="justify-content:space-between">
        <span>${n ? '<button class="btn danger-ghost sm" id="neDelete">Delete</button>' : ''}</span>
        <span class="flex">
          <button class="btn ghost" id="neCancel">Cancel</button>
          <button class="btn" id="neSave">Save</button>
        </span>
      </div>`);
    $('#neCancel', m).onclick = closeModal;
    $('#neSave', m).onclick = async () => {
      const body = {
        title: $('#neTitle', m).value,
        body:  $('#neBody', m).value,
        start_datetime: $('#neDate', m).value || null,
      };
      if (n) body.id = n.id;
      try {
        await api('/pug/api/notes', { method: 'POST', body });
        closeModal(); toast('Saved'); load();
      } catch (e) { toast(e.message, 'error'); }
    };
    const del = $('#neDelete', m);
    if (del) del.onclick = async () => {
      closeModal();
      if (!await confirm({ title: 'Delete note?', text: 'This note will be removed.', okLabel: 'Delete', danger: true })) return;
      try { await api(`/pug/api/notes/${n.id}`, { method: 'DELETE' }); toast('Deleted'); load(); }
      catch (e) { toast(e.message, 'error'); }
    };
    $('#neTitle', m).focus();
  }

  $('#newNoteBtn').addEventListener('click', () => openEditor(null));
  $('#noteSearch').addEventListener('input', debounce(render, 150));
  window.Veyra.when('notes', () => load());
})();
