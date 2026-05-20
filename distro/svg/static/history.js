/* ═══════════════════════════════════════════
   history.js — real API data per user
   ═══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {

  /* ══════════════════════════════
     THEME RESTORE
     ══════════════════════════════ */
  const saved = localStorage.getItem('Eco-Svg-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  /* ══════════════════════════════
     STATE
     ══════════════════════════════ */
  let activeHabit = 'all';
  let activeView  = 'weekly';
  let habits      = [];
  let weeklyData  = [];
  let monthlyData = [];
  let yearlyData  = [];

  /* ══════════════════════════════
     FETCH ALL DATA
     ══════════════════════════════ */
  async function fetchAll() {
    try {
      const [habitsRes, weekRes, monthRes, yearRes, statsRes] = await Promise.all([
        fetch('/api/habits'),
        fetch('/api/stats/weekly'),
        fetch('/api/stats/monthly'),
        fetch('/api/stats/yearly'),
        fetch('/api/stats/today'),
      ]);

      habits      = await habitsRes.json();
      weeklyData  = await weekRes.json();
      monthlyData = await monthRes.json();
      yearlyData  = await yearRes.json();
      const stats = await statsRes.json();

      buildHabitFilter();
      calcDisciplineScore(stats.discipline || 0);
      renderAll();
    } catch(e) {
      console.error('History load failed', e);
    }
  }

  /* ══════════════════════════════
     HABIT FILTER BUTTONS
     ══════════════════════════════ */
  function buildHabitFilter() {
    const container = document.getElementById('habitFilterBtns');
    if (!container) return;
    container.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.className   = 'habit-filter-btn active';
    allBtn.dataset.habit = 'all';
    allBtn.textContent = 'All habits';
    container.appendChild(allBtn);

    habits.forEach(h => {
      const btn = document.createElement('button');
      btn.className    = 'habit-filter-btn';
      btn.dataset.habit = h.id;
      btn.textContent  = h.name;
      container.appendChild(btn);
    });

    container.addEventListener('click', e => {
      const btn = e.target.closest('.habit-filter-btn');
      if (!btn) return;
      document.querySelectorAll('.habit-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeHabit = btn.dataset.habit;
      renderAll();
    });
  }

  /* ══════════════════════════════
     VIEW SWITCHER
     ══════════════════════════════ */
  const switcher = document.getElementById('viewSwitcher');
  if (switcher) {
    switcher.addEventListener('click', e => {
      const btn = e.target.closest('.view-btn');
      if (!btn) return;
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeView = btn.dataset.view;
      renderChart();
    });
  }

  /* ══════════════════════════════
     GET ACTIVE DATA (pct array)
     ══════════════════════════════ */
  function getWeeklyPct() {
    if (activeHabit === 'all') return weeklyData.map(d => d.pct / 100);
    return weeklyData.map(d => d.pct / 100); // per-habit breakdown not yet in API
  }

  function getMonthlyPct() {
    return monthlyData.map(d => d.pct / 100);
  }

  /* ══════════════════════════════
     DISCIPLINE SCORE
     ══════════════════════════════ */
  function calcDisciplineScore(score) {
    const weekPcts  = getWeeklyPct();
    const avg7      = weekPcts.slice(-7).reduce((a,b) => a+b, 0) / 7;
    const prevAvg   = monthlyData.slice(-14, -7).reduce((a,d) => a + d.pct/100, 0) / 7;
    const trend     = avg7 - prevAvg;

    let verdict;
    if (score >= 80) {
      verdict = trend >= 0 ? '↑ Ascending — you\'re building momentum. Keep it up!'
                           : '→ Strong but plateauing. Push for a new personal best.';
    } else if (score >= 55) {
      verdict = trend >= 0 ? '↑ Improving — you\'re on the right track.'
                           : '→ Consistent but not growing. Try adding accountability.';
    } else {
      verdict = trend >= 0 ? '↑ Recovering — small steps count. Don\'t stop now.'
                           : '↓ Needs more discipline — restart with just one habit.';
    }

    const circum = 201;
    const offset = circum - (circum * score / 100);
    const ring   = document.getElementById('disciplineRing');
    const scoreEl= document.getElementById('disciplineScore');
    const verdictEl = document.getElementById('disciplineVerdict');
    if (ring)     ring.style.strokeDashoffset = offset;
    if (scoreEl)  scoreEl.textContent = score;
    if (verdictEl)verdictEl.textContent = verdict;
  }

  /* ══════════════════════════════
     WEEKLY BAR CHART
     ══════════════════════════════ */
  function renderWeekly() {
    const days     = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const barChart = document.getElementById('barChart');
    const barLeg   = document.getElementById('barLegend');
    if (!barChart) return;
    barChart.innerHTML = '';
    barLeg.innerHTML   = '';

    const data   = getWeeklyPct();
    const maxVal = Math.max(...data, 0.01);

    data.forEach((val, i) => {
      const pct       = Math.round(val * 100);
      const heightPct = (val / maxVal) * 100;

      const group = document.createElement('div');
      group.className = 'bar-group';

      const col = document.createElement('div');
      col.className  = 'bar-col';
      col.style.height = '0%';
      col.innerHTML  = `<span class="bar-col-tip">${pct}%</span>`;
      if (val === 0) col.style.opacity = '0.2';

      group.appendChild(col);
      barChart.appendChild(group);

      setTimeout(() => { col.style.height = `${heightPct}%`; }, 50 + i * 60);

      const label = document.createElement('span');
      label.className   = 'bar-day-label';
      label.textContent = days[i];
      barLeg.appendChild(label);
    });
  }

  /* ══════════════════════════════
     MONTHLY LINE CHART
     ══════════════════════════════ */
  function renderMonthly() {
    const svg     = document.getElementById('lineChartSvg');
    const xLabels = document.getElementById('lineXLabels');
    if (!svg) return;
    svg.innerHTML   = '';
    xLabels.innerHTML = '';

    const data = getMonthlyPct();
    const W = 600, H = 200, pad = 10;

    const points = data.map((v, i) => ({
      x: pad + (i / (data.length - 1)) * (W - pad * 2),
      y: H - pad - v * (H - pad * 2),
    }));

    const areaD = `M ${points[0].x} ${H-pad} ` +
      points.map(p => `L ${p.x} ${p.y}`).join(' ') +
      ` L ${points[points.length-1].x} ${H-pad} Z`;
    const area = document.createElementNS('http://www.w3.org/2000/svg','path');
    area.setAttribute('d', areaD);
    area.setAttribute('class', 'line-area');
    svg.appendChild(area);

    const lineD = points.map((p,i) => `${i===0?'M':'L'} ${p.x} ${p.y}`).join(' ');
    const line = document.createElementNS('http://www.w3.org/2000/svg','path');
    line.setAttribute('d', lineD);
    line.setAttribute('class', 'line-path');
    svg.appendChild(line);

    points.forEach((p, i) => {
      if (i % 5 !== 0 && i !== data.length - 1) return;
      const circle = document.createElementNS('http://www.w3.org/2000/svg','circle');
      circle.setAttribute('cx', p.x);
      circle.setAttribute('cy', p.y);
      circle.setAttribute('r', 3.5);
      circle.setAttribute('class', 'line-dot');
      svg.appendChild(circle);
    });

    [1, 8, 15, 22, 30].forEach(d => {
      const span = document.createElement('span');
      span.className   = 'line-x-label';
      span.textContent = `Day ${d}`;
      xLabels.appendChild(span);
    });
  }

  /* ══════════════════════════════
     YEARLY HEATMAP
     ══════════════════════════════ */
  function renderYearly() {
    const heatmap     = document.getElementById('yearHeatmap');
    const monthLabels = document.getElementById('yearMonthLabels');
    if (!heatmap) return;
    heatmap.innerHTML      = '';
    monthLabels.innerHTML  = '';

    yearlyData.forEach(day => {
      const cell = document.createElement('div');
      cell.className      = 'year-cell';
      cell.dataset.level  = day.level;
      cell.title          = `${day.date}: level ${day.level}`;
      heatmap.appendChild(cell);
    });

    const months      = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const daysInMonth = [31,28,31,30,31,30,31,31,30,31,30,31];
    daysInMonth.forEach((days, i) => {
      const label = document.createElement('span');
      label.className       = 'year-month-label';
      label.textContent     = months[i];
      const weeksWide       = Math.ceil(days / 7);
      label.style.width     = `${weeksWide * 15}px`;
      label.style.display   = 'inline-block';
      monthLabels.appendChild(label);
    });
  }

  /* ══════════════════════════════
     STREAK TABLE
     ══════════════════════════════ */
  function renderStreaks() {
    const list = document.getElementById('streakList');
    if (!list) return;
    list.innerHTML = '';

    const toShow = activeHabit === 'all'
      ? habits
      : habits.filter(h => String(h.id) === String(activeHabit));

    if (toShow.length === 0) {
      list.innerHTML = '<div style="color:var(--clr-text-muted);font-size:0.8rem;padding:1rem 0">No habits yet</div>';
      return;
    }

    toShow.forEach(h => {
      const streak    = h.streak || 0;
      const best      = Math.max(streak, 1);
      const pct       = Math.round((streak / best) * 100);
      const trendLabel = streak > 0 ? '↑ Active' : '→ Not started';
      const trendClass = streak > 0 ? 'up' : 'same';

      const row = document.createElement('div');
      row.className = 'streak-row';
      row.innerHTML = `
        <span class="streak-habit-name">${h.name}</span>
        <span class="streak-trend ${trendClass}">${trendLabel}</span>
        <span class="streak-days">${streak}d</span>
        <div class="streak-minibar">
          <div class="streak-minibar-fill" style="width:${pct}%"></div>
        </div>`;
      list.appendChild(row);
    });
  }

  /* ══════════════════════════════
     RENDER CHART BY VIEW
     ══════════════════════════════ */
  function renderChart() {
    ['panelWeekly','panelMonthly','panelYearly'].forEach(id => {
      document.getElementById(id)?.classList.add('hidden');
    });

    if (activeView === 'weekly') {
      document.getElementById('panelWeekly')?.classList.remove('hidden');
      renderWeekly();
    } else if (activeView === 'monthly') {
      document.getElementById('panelMonthly')?.classList.remove('hidden');
      renderMonthly();
    } else {
      document.getElementById('panelYearly')?.classList.remove('hidden');
      renderYearly();
    }
  }

  function renderAll() {
    renderChart();
    renderStreaks();
  }

  /* ── INIT ── */
  await fetchAll();
});