/* Goals + dream. */
(function () {
  'use strict';
  const { $, api, esc, toast, confirm } = window.Veyra;

  function rowHtml(g, kind) {
    return `
      <div class="row-main">
        <div class="row-title" ${kind === 'finished' ? 'style="text-decoration:line-through;color:var(--text-3)"' : ''}>${esc(g.title)}</div>
        <div class="row-sub">${g.created_at ? new Date(g.created_at).toLocaleDateString() : ''}</div>
      </div>`;
  }

  async function load() {
    try {
      const [goals, cancelled] = await Promise.all([
        api('/pug/api/goals'),
        api('/pug/api/goals/cancelled'),
      ]);
      const active   = goals.filter(g => !g.is_finished);
      const finished = goals.filter(g => g.is_finished);

      const aw = $('#activeGoals'); aw.innerHTML = '';
      if (!active.length) aw.innerHTML = '<div class="empty">No active goals.</div>';
      active.forEach(g => {
        const row = document.createElement('div');
        row.className = 'row-item';
        row.innerHTML = `
          <button class="check" title="Mark finished"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></button>
          ${rowHtml(g, 'active')}
          <div class="row-actions"><button class="icon-btn danger" title="Cancel goal">✕</button></div>`;
        row.querySelector('.check').onclick = async () => {
          if (!await confirm({ title: 'Crushed it?', text: `Move "${g.title}" to Finished?`, okLabel: 'Finished it' })) return;
          await api(`/pug/api/goals/${g.id}`, { method: 'PATCH', body: { is_finished: true } });
          toast('Goal finished 🎉'); load();
          document.dispatchEvent(new CustomEvent('veyra:goals-changed'));
        };
        row.querySelector('.icon-btn').onclick = async () => {
          if (!await confirm({ title: 'Cancel goal?', text: 'It moves to Cancelled.', okLabel: 'Cancel goal', danger: true })) return;
          await api(`/pug/api/goals/${g.id}`, { method: 'DELETE' });
          load();
          document.dispatchEvent(new CustomEvent('veyra:goals-changed'));
        };
        aw.appendChild(row);
      });

      const fw = $('#finishedGoals'); fw.innerHTML = '';
      if (!finished.length) fw.innerHTML = '<div class="empty">Nothing yet.</div>';
      finished.slice(-15).reverse().forEach(g => {
        const row = document.createElement('div');
        row.className = 'row-item';
        row.innerHTML = `<span class="tag ok">✓</span>${rowHtml(g, 'finished')}`;
        fw.appendChild(row);
      });

      const cw = $('#cancelledGoals'); cw.innerHTML = '';
      if (!cancelled.length) cw.innerHTML = '<div class="empty">Nothing here.</div>';
      cancelled.forEach(g => {
        const row = document.createElement('div');
        row.className = 'row-item';
        row.innerHTML = `<span class="tag">–</span>${rowHtml(g, 'cancelled')}`;
        cw.appendChild(row);
      });
    } catch (e) { /* ignore */ }
  }

  async function loadDream() {
    const area = $('#dreamArea');
    try {
      const d = await api('/pug/api/dream');
      if (d.dream) {
        area.innerHTML = `<div class="flex"><span class="tag accent">Locked</span>
          <strong>${esc(d.dream)}</strong></div>`;
      } else {
        area.innerHTML = `
          <div class="field-row">
            <input class="input" id="dreamInput" placeholder="The one thing you're moving toward…" maxlength="500">
            <button class="btn" id="dreamLockBtn">Lock in</button>
          </div>`;
        $('#dreamLockBtn').onclick = async () => {
          const title = $('#dreamInput').value.trim();
          if (!title) return;
          if (!await confirm({ title: 'Lock in dream?', text: 'Once set, this is your locked trajectory. It cannot be changed.', okLabel: 'Lock it in' })) return;
          try {
            await api('/pug/api/dream', { method: 'POST', body: { title } });
            toast('Dream locked'); loadDream(); window.Veyra.refreshDream();
          } catch (e) { toast(e.message, 'error'); }
        };
      }
    } catch (e) { /* ignore */ }
  }

  async function addGoal() {
    const input = $('#newGoalInput');
    const title = input.value.trim();
    if (!title) return;
    try {
      await api('/pug/api/goals', { method: 'POST', body: { title } });
      input.value = '';
      load();
      document.dispatchEvent(new CustomEvent('veyra:goals-changed'));
    } catch (e) { toast(e.message, 'error'); }
  }
  $('#addGoalBtn').addEventListener('click', addGoal);
  $('#newGoalInput').addEventListener('keydown', e => { if (e.key === 'Enter') addGoal(); });

  window.Veyra.when('goals', () => { load(); loadDream(); });
})();
