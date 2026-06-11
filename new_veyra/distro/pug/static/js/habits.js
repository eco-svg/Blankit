/* Habits: list, toggle, 30-day history. */
(function () {
  'use strict';
  const { $, api, esc, toast, confirm } = window.Veyra;

  function loadHistory() {
    api('/pug/api/habits/history?days=30').then(days => {
      const wrap = $('#habitHistory');
      wrap.innerHTML = '';
      days.forEach(d => {
        const bar = document.createElement('div');
        bar.className = 'hh-bar';
        bar.style.height = Math.max(2, Math.round(d.pct * 0.66)) + 'px';
        bar.title = `${d.date}: ${d.pct}%`;
        wrap.appendChild(bar);
      });
      if (!days.length) wrap.innerHTML = '<div class="empty">Add a habit to see history.</div>';
    }).catch(() => {});
  }

  function load() {
    api('/pug/api/habits').then(habits => {
      const wrap = $('#habitList');
      wrap.innerHTML = '';
      if (!habits.length) wrap.innerHTML = '<div class="empty">No habits yet — small daily reps win.</div>';
      habits.forEach(h => {
        const row = document.createElement('div');
        row.className = 'row-item';
        row.innerHTML = `
          <button class="check ${h.done_today ? 'checked' : ''}" aria-label="Toggle habit">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <div class="row-main"><div class="row-title">${esc(h.name)}</div></div>
          <div class="row-actions"><button class="icon-btn danger" title="Delete habit">✕</button></div>`;
        const check = row.querySelector('.check');
        check.onclick = async () => {
          try {
            const d = await api(`/pug/api/habits/${h.id}/toggle`, { method: 'POST' });
            check.classList.toggle('checked', d.done);
            loadHistory();
            document.dispatchEvent(new CustomEvent('veyra:habits-changed'));
          } catch (e) { toast(e.message, 'error'); }
        };
        row.querySelector('.icon-btn').onclick = async () => {
          if (!await confirm({ title: 'Delete habit?', text: `"${h.name}" and all its history will be removed permanently.`, okLabel: 'Delete forever', danger: true })) return;
          try {
            await api(`/pug/api/habits/${h.id}`, { method: 'DELETE' });
            load(); loadHistory();
            document.dispatchEvent(new CustomEvent('veyra:habits-changed'));
          } catch (e) { toast(e.message, 'error'); }
        };
        wrap.appendChild(row);
      });
    }).catch(() => {});
  }

  async function addHabit() {
    const input = $('#newHabitInput');
    const name = input.value.trim();
    if (!name) return;
    try {
      await api('/pug/api/habits', { method: 'POST', body: { name } });
      input.value = '';
      load(); loadHistory();
      document.dispatchEvent(new CustomEvent('veyra:habits-changed'));
    } catch (e) { toast(e.message, 'error'); }
  }
  $('#addHabitBtn').addEventListener('click', addHabit);
  $('#newHabitInput').addEventListener('keydown', e => { if (e.key === 'Enter') addHabit(); });

  window.Veyra.when('habits', () => { load(); loadHistory(); });
})();
