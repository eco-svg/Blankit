/* ═══════════════════════════════════════════
   history.js — ecosvg
   History charts + discipline score (localStorage mock)
   ═══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  /* ══════════════════════════════
     MOCK DATA (replace with real data later)
     ══════════════════════════════ */
  const habits = [
    { name: 'Morning walk',   streak: 12, bestStreak: 18, history: randomHistory(365, 0.82) },
    { name: 'Drink 2L water', streak: 7,  bestStreak: 14, history: randomHistory(365, 0.74) },
    { name: 'Read 20 pages',  streak: 3,  bestStreak: 9,  history: randomHistory(365, 0.45) },
    { name: '10 push-ups',    streak: 5,  bestStreak: 11, history: randomHistory(365, 0.60) },
    { name: 'Meditate 10min', streak: 2,  bestStreak: 7,  history: randomHistory(365, 0.38) },
  ];

  function randomHistory(days, rate) {
    /* generate mock daily completion booleans */
    const arr = [];
    for (let i = 0; i < days; i++) {
      /* recent days slightly better to show improvement */
      const bias = i > days - 30 ? rate + 0.1 : rate;
      arr.push(Math.random() < Math.min(bias, 1) ? 1 : 0);
    }
    return arr;
  }

  /* ══════════════════════════════
     STATE
     ══════════════════════════════ */
  let activeHabit = 'all';
  let activeView  = 'weekly';

  /* ══════════════════════════════
     HABIT FILTER BUTTONS
     ══════════════════════════════ */
  const habitFilterBtns = document.getElementById('habitFilterBtns');
  habits.forEach(h => {
    const btn = document.createElement('button');
    btn.className = 'habit-filter-btn';
    btn.dataset.habit = h.name;
    btn.textContent = h.name;
    habitFilterBtns.appendChild(btn);
  });

  habitFilterBtns.addEventListener('click', e => {
    const btn = e.target.closest('.habit-filter-btn');
    if (!btn) return;
    document.querySelectorAll('.habit-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeHabit = btn.dataset.habit;
    renderAll();
  });

  /* ══════════════════════════════
     VIEW SWITCHER
     ══════════════════════════════ */
  document.getElementById('viewSwitcher').addEventListener('click', e => {
    const btn = e.target.closest('.view-btn');
    if (!btn) return;
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeView = btn.dataset.view;
    renderChart();
  });

  /* ══════════════════════════════
     GET ACTIVE DATA
     ══════════════════════════════ */
  function getActiveHistory() {
    if (activeHabit === 'all') {
      /* average across all habits per day */
      const len = habits[0].history.length;
      return Array.from({ length: len }, (_, i) => {
        const avg = habits.reduce((s, h) => s + h.history[i], 0) / habits.length;
        return avg;
      });
    }
    const h = habits.find(h => h.name === activeHabit);
    return h ? h.history.map(v => v) : [];
  }

  /* ══════════════════════════════
     DISCIPLINE SCORE
     ══════════════════════════════ */
  function calcDisciplineScore() {
    const history = getActiveHistory();
    const last30  = history.slice(-30);
    const last7   = history.slice(-7);
    const prev7   = history.slice(-14, -7);

    const avg30 = last30.reduce((a, b) => a + b, 0) / last30.length;
    const avg7  = last7.reduce((a, b)  => a + b, 0) / last7.length;
    const avgP7 = prev7.reduce((a, b)  => a + b, 0) / prev7.length;

    const score = Math.round(avg30 * 100);
    const trend = avg7 - avgP7;

    let verdict = '';
    if (score >= 80) {
      verdict = trend >= 0
        ? '↑ Ascending — you\'re building momentum. Keep it up!'
        : '→ Strong but plateauing. Push for a new personal best.';
    } else if (score >= 55) {
      verdict = trend >= 0
        ? '↑ Improving — you\'re on the right track.'
        : '→ Consistent but not growing. Try adding accountability.';
    } else {
      verdict = trend >= 0
        ? '↑ Recovering — small steps count. Don\'t stop now.'
        : '↓ Needs more discipline — restart with just one habit.';
    }

    /* animate ring */
    const circum = 201;
    const offset = circum - (circum * score / 100);
    document.getElementById('disciplineRing').style.strokeDashoffset = offset;
    document.getElementById('disciplineScore').textContent = score;
    document.getElementById('disciplineVerdict').textContent = verdict;
  }

  /* ══════════════════════════════
     WEEKLY BAR CHART
     ══════════════════════════════ */
  function renderWeekly() {
    const history = getActiveHistory();
    const days    = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const barChart  = document.getElementById('barChart');
    const barLegend = document.getElementById('barLegend');
    barChart.innerHTML = '';
    barLegend.innerHTML = '';

    /* get last 7 days */
    const last7 = history.slice(-7);
    const maxVal = Math.max(...last7, 0.01);

    last7.forEach((val, i) => {
      const pct = Math.round(val * 100);
      const heightPct = (val / maxVal) * 100;

      const group = document.createElement('div');
      group.className = 'bar-group';

      const col = document.createElement('div');
      col.className = 'bar-col';
      col.style.height = '0%';
      col.innerHTML = `<span class="bar-col-tip">${pct}%</span>`;

      /* lower opacity for 0% days */
      if (val === 0) col.style.opacity = '0.2';

      group.appendChild(col);
      barChart.appendChild(group);

      /* animate in */
      setTimeout(() => { col.style.height = `${heightPct}%`; }, 50 + i * 60);

      const label = document.createElement('span');
      label.className = 'bar-day-label';
      label.textContent = days[i];
      barLegend.appendChild(label);
    });
  }

  /* ══════════════════════════════
     MONTHLY LINE CHART (SVG)
     ══════════════════════════════ */
  function renderMonthly() {
    const history = getActiveHistory();
    const last30  = history.slice(-30);
    const svg     = document.getElementById('lineChartSvg');
    const xLabels = document.getElementById('lineXLabels');
    svg.innerHTML = '';
    xLabels.innerHTML = '';

    const W = 600, H = 200, pad = 10;
    const points = last30.map((v, i) => ({
      x: pad + (i / (last30.length - 1)) * (W - pad * 2),
      y: H - pad - v * (H - pad * 2),
    }));

    /* area */
    const areaD = `M ${points[0].x} ${H - pad} ` +
      points.map(p => `L ${p.x} ${p.y}`).join(' ') +
      ` L ${points[points.length-1].x} ${H - pad} Z`;
    const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    area.setAttribute('d', areaD);
    area.setAttribute('class', 'line-area');
    svg.appendChild(area);

    /* line */
    const lineD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', lineD);
    line.setAttribute('class', 'line-path');
    svg.appendChild(line);

    /* dots every 5 days */
    points.forEach((p, i) => {
      if (i % 5 !== 0 && i !== last30.length - 1) return;
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', p.x);
      circle.setAttribute('cy', p.y);
      circle.setAttribute('r', 3.5);
      circle.setAttribute('class', 'line-dot');
      circle.setAttribute('title', `Day ${i+1}: ${Math.round(last30[i]*100)}%`);
      svg.appendChild(circle);
    });

    /* x labels */
    [1, 8, 15, 22, 30].forEach(d => {
      const span = document.createElement('span');
      span.className = 'line-x-label';
      span.textContent = `Day ${d}`;
      xLabels.appendChild(span);
    });
  }

  /* ══════════════════════════════
     YEARLY HEATMAP
     ══════════════════════════════ */
  function renderYearly() {
    const history      = getActiveHistory();
    const heatmap      = document.getElementById('yearHeatmap');
    const monthLabels  = document.getElementById('yearMonthLabels');
    heatmap.innerHTML  = '';
    monthLabels.innerHTML = '';

    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const daysInMonth = [31,28,31,30,31,30,31,31,30,31,30,31];

    /* pad to 364 days (52 weeks) */
    const data = history.slice(-364);
    while (data.length < 364) data.unshift(0);

    data.forEach(val => {
      const cell = document.createElement('div');
      cell.className = 'year-cell';
      const level = val === 0 ? 0 : val < 0.4 ? 1 : val < 0.7 ? 2 : val < 0.9 ? 3 : 4;
      cell.dataset.level = level;
      heatmap.appendChild(cell);
    });

    /* month labels roughly positioned */
    let dayCount = 0;
    daysInMonth.forEach((days, i) => {
      const label = document.createElement('span');
      label.className = 'year-month-label';
      label.textContent = months[i];
      const weeksWide = Math.ceil(days / 7);
      label.style.width = `${weeksWide * 15}px`;
      label.style.display = 'inline-block';
      monthLabels.appendChild(label);
      dayCount += days;
    });
  }

  /* ══════════════════════════════
     STREAK TABLE
     ══════════════════════════════ */
  function renderStreaks() {
    const list = document.getElementById('streakList');
    list.innerHTML = '';

    const toShow = activeHabit === 'all'
      ? habits
      : habits.filter(h => h.name === activeHabit);

    toShow.forEach(h => {
      const last14  = h.history.slice(-14);
      const thisWeek = last14.slice(7).reduce((a,b) => a+b, 0);
      const lastWeek = last14.slice(0,7).reduce((a,b) => a+b, 0);
      const diff = thisWeek - lastWeek;
      const trend = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
      const trendLabel = diff > 0 ? '↑ Ascending' : diff < 0 ? '↓ Needs discipline' : '→ Consistent';
      const pct = Math.round((h.streak / Math.max(h.bestStreak, 1)) * 100);

      const row = document.createElement('div');
      row.className = 'streak-row';
      row.innerHTML = `
        <span class="streak-habit-name">${h.name}</span>
        <span class="streak-trend ${trend}">${trendLabel}</span>
        <span class="streak-days">${h.streak}d</span>
        <div class="streak-minibar">
          <div class="streak-minibar-fill" style="width:${pct}%"></div>
        </div>
      `;
      list.appendChild(row);
    });
  }

  /* ══════════════════════════════
     RENDER CHART BY VIEW
     ══════════════════════════════ */
  function renderChart() {
    document.getElementById('panelWeekly').classList.add('hidden');
    document.getElementById('panelMonthly').classList.add('hidden');
    document.getElementById('panelYearly').classList.add('hidden');

    if (activeView === 'weekly') {
      document.getElementById('panelWeekly').classList.remove('hidden');
      renderWeekly();
    } else if (activeView === 'monthly') {
      document.getElementById('panelMonthly').classList.remove('hidden');
      renderMonthly();
    } else {
      document.getElementById('panelYearly').classList.remove('hidden');
      renderYearly();
    }
  }

  function renderAll() {
    calcDisciplineScore();
    renderChart();
    renderStreaks();
  }

  /* ── INIT ── */
  renderAll();

}); /* end DOMContentLoaded */