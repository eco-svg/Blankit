(function () {
  let habits = [];
  let chartInstance = null;

  const flipInner   = document.getElementById('habitFlipInner');
  const flipBtn     = document.getElementById('habitFlipBtn');
  const flipBackBtn = document.getElementById('habitFlipBackBtn');
  const pulseBtn     = document.getElementById('habitPulseBtn');
  const pulseBackBtn = document.getElementById('habitPulseBackBtn');
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

  // ── Mobile flip: manage ↔ today inside front face ────
  const faceFront = document.getElementById('habitFaceFront');
  function flip(toBack) {
    if (!faceFront) return;
    faceFront.classList.toggle('flipped', toBack);
  }
  if (flipBtn)     flipBtn.addEventListener('click',     () => flip(true));
  if (flipBackBtn) flipBackBtn.addEventListener('click', () => flip(false));

  // ── Desktop flip: front face ↔ pulse back face ───────
  function flipToPulse(toBack) {
    if (!flipInner) return;
    flipInner.classList.toggle('pulse-flipped', toBack);
    if (toBack) window.dispatchEvent(new Event('habitPulseFlipped'));
  }
  if (pulseBtn)     pulseBtn.addEventListener('click',     () => flipToPulse(true));
  if (pulseBackBtn) pulseBackBtn.addEventListener('click', () => flipToPulse(false));

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
        <span class="habit-manage-dot"></span>
        <span class="habit-name">${h.name}</span>
        ${h.id != null
          ? `<button class="habit-del-btn" data-id="${h.id}" title="Remove">✕</button>`
          : `<span style="font-size:0.62rem;opacity:0.35;font-family:var(--font-mono);margin-left:auto">saving…</span>`}
      </li>`).join('');
    manageList.querySelectorAll('.habit-del-btn').forEach(btn =>
      btn.addEventListener('click', () => deleteHabit(+btn.dataset.id))
    );
  }

  function renderToday() {
    if (!todayList) return;
    const confirmed = habits.filter(h => h.id != null);
    if (!confirmed.length) {
      todayList.innerHTML = '<li class="habit-empty">Add habits on the left.</li>';
      if (todayFooter) todayFooter.textContent = '';
      return;
    }
    todayList.innerHTML = confirmed.map(h => `
      <li class="habit-today-item${h.done_today ? ' done' : ''}" data-id="${h.id}">
        <span class="habit-check">${h.done_today ? '✓' : ''}</span>
        <span class="habit-name">${h.name}</span>
      </li>`).join('');
    todayList.querySelectorAll('.habit-today-item').forEach(li =>
      li.addEventListener('click', () => toggleHabit(+li.dataset.id))
    );
    const done  = confirmed.filter(h => h.done_today).length;
    const total = confirmed.length;
    const pct   = total ? Math.round(done / total * 100) : 0;
    if (todayFooter) {
      todayFooter.innerHTML = `
        <div class="habit-progress-wrap">
          <div class="habit-progress-bar" style="width:${pct}%"></div>
        </div>
        <span class="habit-progress-label">${done} / ${total} done today${pct === 100 ? ' — all done!' : ''}</span>
      `;
    }
  }

  // ── Add (optimistic) ──────────────────────────────────
  async function addHabit() {
    const name = (habitInput?.value || '').trim();
    if (!name) return;
    habitInput.value = '';
    const temp = { id: null, name, done_today: false };
    habits.push(temp);
    renderManage();
    renderToday();
    try {
      const res = await fetch('/pug/api/habits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (res.ok) {
        const data = await res.json();
        temp.id = data.id;
        temp.done_today = data.done_today ?? false;
      } else {
        habits = habits.filter(h => h !== temp);
      }
    } catch (e) {
      habits = habits.filter(h => h !== temp);
    }
    renderManage();
    renderToday();
  }
  if (habitAddBtn) habitAddBtn.addEventListener('click', addHabit);
  if (habitInput)  habitInput.addEventListener('keypress', e => { if (e.key === 'Enter') addHabit(); });

  // ── Delete (optimistic) ───────────────────────────────
  async function deleteHabit(id) {
    habits = habits.filter(h => h.id !== id);
    renderManage();
    renderToday();
    try {
      await fetch(`/pug/api/habits/${id}`, { method: 'DELETE' });
    } catch (e) {
      await loadHabits(); // revert on network failure
    }
  }

  // ── Toggle (already optimistic) ───────────────────────
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
      window.dispatchEvent(new Event('habitUpdated'));
    } catch (e) { h.done_today = !h.done_today; renderToday(); }
  }

  function renderChart(history) {
    const canvas = document.getElementById('habitChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    if (!history.length) return;
    const labels = history.map(d => {
      const dt = new Date(d.date + 'T00:00:00');
      return dt.toLocaleDateString('en', { month: 'short', day: 'numeric' });
    });
    chartInstance = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Daily Completion %',
          data: history.map(d => d.pct),
          borderColor: '#d4a574',
          backgroundColor: 'rgba(212,165,116,0.10)',
          borderWidth: 2.5,
          pointBackgroundColor: '#d4a574',
          pointBorderColor: '#1c1915',
          pointBorderWidth: 2,
          pointRadius: 4,
          tension: 0.4,
          fill: true,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(28,25,21,0.92)',
            titleColor: '#ede7d4',
            bodyColor: '#ede7d4',
            borderColor: '#2c2720',
            borderWidth: 1,
            padding: 10,
            callbacks: { label: ctx => ` ${ctx.parsed.y}% habits done` },
          },
        },
        scales: {
          x: {
            grid: { display: false, drawBorder: false },
            ticks: {
              color: 'rgba(200,200,200,0.35)',
              font: { size: 10, family: 'monospace' },
              autoSkip: true, maxTicksLimit: 10,
            },
          },
          y: {
            min: 0, max: 100,
            grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
            ticks: {
              color: 'rgba(200,200,200,0.35)',
              font: { size: 10, family: 'monospace' },
              stepSize: 25,
              callback: v => v + '%',
            },
          }
        }
      }
    });
  }

  loadHabits();
})();
