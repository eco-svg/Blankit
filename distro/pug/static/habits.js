(function () {
  let habits = [];
  let chartInstance = null;

  const flipInner   = document.getElementById('habitFlipInner');
  const flipBtn     = document.getElementById('habitFlipBtn');
  const flipBackBtn = document.getElementById('habitFlipBackBtn');
  const habitInput  = document.getElementById('habitNameInput');
  const habitAddBtn = document.getElementById('habitAddBtn');
  const manageList  = document.getElementById('habitManageList');
  const todayList   = document.getElementById('habitTodayList');
  const todayFooter = document.getElementById('habitTodayFooter');
  const todayDateEl = document.getElementById('habitTodayDate');

  if (todayDateEl) {
    todayDateEl.textContent = new Date().toLocaleDateString('en', {
      weekday: 'short', month: 'short', day: 'numeric'
    });
  }

  // ── Flip ─────────────────────────────────────────────
  function flip(toBack) {
    if (!flipInner) return;
    flipInner.classList.toggle('flipped', toBack);
    if (toBack) loadChart();
  }
  if (flipBtn)     flipBtn.addEventListener('click',     () => flip(true));
  if (flipBackBtn) flipBackBtn.addEventListener('click', () => flip(false));

  // ── Load & render ─────────────────────────────────────
  async function loadHabits() {
    try {
      const res = await fetch('/pug/api/habits');
      if (!res.ok) return;
      habits = await res.json();
      renderManage();
      renderToday();
    } catch (e) {}
  }

  function renderManage() {
    if (!manageList) return;
    if (!habits.length) {
      manageList.innerHTML = '<li class="habit-empty">No habits yet — add one above.</li>';
      return;
    }
    manageList.innerHTML = habits.map(h => `
      <li class="habit-manage-item">
        <span class="habit-name">${h.name}</span>
        <button class="habit-del-btn" data-id="${h.id}" title="Remove">✕</button>
      </li>`).join('');
    manageList.querySelectorAll('.habit-del-btn').forEach(btn =>
      btn.addEventListener('click', () => deleteHabit(+btn.dataset.id))
    );
  }

  function renderToday() {
    if (!todayList) return;
    if (!habits.length) {
      todayList.innerHTML = '<li class="habit-empty">Add habits on the left.</li>';
      if (todayFooter) todayFooter.textContent = '';
      return;
    }
    todayList.innerHTML = habits.map(h => `
      <li class="habit-today-item${h.done_today ? ' done' : ''}" data-id="${h.id}">
        <span class="habit-check">${h.done_today ? '✓' : ''}</span>
        <span class="habit-name">${h.name}</span>
      </li>`).join('');
    todayList.querySelectorAll('.habit-today-item').forEach(li =>
      li.addEventListener('click', () => toggleHabit(+li.dataset.id))
    );
    const done = habits.filter(h => h.done_today).length;
    if (todayFooter) todayFooter.textContent = `${done} / ${habits.length} done today`;
  }

  // ── Add ───────────────────────────────────────────────
  async function addHabit() {
    const name = (habitInput?.value || '').trim();
    if (!name) return;
    habitInput.value = '';
    try {
      const res = await fetch('/pug/api/habits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (res.ok) await loadHabits();
    } catch (e) {}
  }
  if (habitAddBtn) habitAddBtn.addEventListener('click', addHabit);
  if (habitInput)  habitInput.addEventListener('keypress', e => { if (e.key === 'Enter') addHabit(); });

  // ── Delete ────────────────────────────────────────────
  async function deleteHabit(id) {
    try {
      await fetch(`/pug/api/habits/${id}`, { method: 'DELETE' });
      await loadHabits();
    } catch (e) {}
  }

  // ── Toggle ────────────────────────────────────────────
  async function toggleHabit(id) {
    const h = habits.find(x => x.id === id);
    if (!h) return;
    h.done_today = !h.done_today;
    renderToday();
    try {
      const res = await fetch(`/pug/api/habits/${id}/toggle`, { method: 'POST' });
      if (!res.ok) { h.done_today = !h.done_today; renderToday(); return; }
      const data = await res.json();
      h.done_today = data.done;
      renderToday();
    } catch (e) { h.done_today = !h.done_today; renderToday(); }
  }

  // ── Chart ─────────────────────────────────────────────
  async function loadChart() {
    try {
      const res = await fetch('/pug/api/habits/history?days=30');
      if (!res.ok) return;
      renderChart(await res.json());
    } catch (e) {}
  }

  function renderChart(history) {
    const canvas = document.getElementById('habitChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    const labels = history.map(d => {
      const dt = new Date(d.date + 'T00:00:00');
      return dt.toLocaleDateString('en', { month: 'short', day: 'numeric' });
    });
    chartInstance = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: history.map(d => d.pct),
          backgroundColor: history.map(d =>
            d.pct >= 80 ? 'rgba(120,184,120,0.75)' :
            d.pct >= 50 ? 'rgba(200,169,110,0.65)' :
                          'rgba(100,100,130,0.4)'
          ),
          borderRadius: 4,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.raw}% completed` } }
        },
        scales: {
          x: {
            ticks: {
              color: 'rgba(200,200,200,0.4)',
              font: { size: 10, family: 'monospace' },
              maxRotation: 45, autoSkip: true, maxTicksLimit: 10
            },
            grid: { color: 'rgba(255,255,255,0.04)' }
          },
          y: {
            min: 0, max: 100,
            ticks: {
              color: 'rgba(200,200,200,0.4)',
              font: { size: 10, family: 'monospace' },
              callback: v => v + '%'
            },
            grid: { color: 'rgba(255,255,255,0.04)' }
          }
        }
      }
    });
  }

  loadHabits();
})();
