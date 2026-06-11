/* Dashboard: clock, weather, wisdom, stats tiles, today's goals, consistency. */
(function () {
  'use strict';
  const { $, api, esc, toast } = window.Veyra;

  // ── clock ──────────────────────────────────────────────────
  function tick() {
    const now = new Date();
    const clock = $('#tbClock');
    if (clock) clock.textContent =
      now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const hero = $('#heroDate');
    if (hero) hero.textContent =
      now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const g = $('#greeting');
    if (g) {
      const h = now.getHours();
      const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
      g.textContent = `${part}, ${window.Veyra.username}`;
    }
  }
  tick();
  setInterval(tick, 30000);

  // ── weather (geolocation optional) ─────────────────────────
  function loadWeather(lat, lon) {
    const qs = (lat != null) ? `?lat=${lat}&lon=${lon}` : '';
    api('/pug/api/weather' + qs).then(d => {
      const cw = d && d.current_weather;
      if (!cw) return;
      $('#tbWeather').textContent = `${Math.round(cw.temperature)}°C`;
    }).catch(() => {});
  }
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      p => {
        loadWeather(p.coords.latitude, p.coords.longitude);
        // Save for community radius feature
        api('/pug/api/location', { method: 'POST',
          body: { lat: p.coords.latitude, lng: p.coords.longitude } }).catch(() => {});
        window.Veyra.geo = { lat: p.coords.latitude, lng: p.coords.longitude };
      },
      () => loadWeather(),
      { timeout: 5000 }
    );
  } else loadWeather();

  // ── wisdom ─────────────────────────────────────────────────
  api('/pug/api/wisdom').then(d => {
    if (d && d.text) $('#wisdomLine').textContent = d.text;
  }).catch(() => { $('#wisdomLine').textContent = 'Keep going.'; });

  // ── dream chip ─────────────────────────────────────────────
  window.Veyra.refreshDream = function () {
    api('/pug/api/dream').then(d => {
      const chip = $('#dreamChip');
      if (d.dream) {
        $('#dreamChipText').textContent = d.dream;
        chip.classList.remove('hidden');
      } else chip.classList.add('hidden');
    }).catch(() => {});
  };
  window.Veyra.refreshDream();

  // ── stats tiles + rank ─────────────────────────────────────
  function loadStats() {
    api('/pug/api/stats?cache_only=true').then(d => {
      $('#stNotes').textContent  = d.notes_count;
      $('#stStreak').textContent = d.streak;
      const sheet = d.sheet || {};
      const skills = sheet.skills || [];
      const order = ['S+','S','S-','A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','E+','E','E-'];
      let best = null;
      for (const r of order) {
        if (skills.some(s => (s.rank || '').toUpperCase() === r && s.verified !== false)) { best = r; break; }
      }
      const badge = $('#heroRank'), chip = $('#chipRank');
      if (best) {
        badge.textContent = best;
        badge.classList.remove('unranked');
        if (chip) chip.textContent = 'rank ' + best;
      }
    }).catch(() => {});
  }

  // ── today's goals quick list ───────────────────────────────
  function loadDashGoals() {
    api('/pug/api/goals').then(goals => {
      const active = goals.filter(g => !g.is_finished);
      $('#stGoals').textContent = active.length;
      const wrap = $('#dashGoals');
      wrap.innerHTML = '';
      if (!active.length) {
        wrap.innerHTML = '<div class="empty">No active goals — add one in Goals.</div>';
        return;
      }
      active.slice(0, 6).forEach(g => {
        const row = document.createElement('div');
        row.className = 'row-item';
        row.innerHTML = `
          <button class="check" aria-label="Finish goal"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></button>
          <div class="row-main"><div class="row-title">${esc(g.title)}</div></div>`;
        row.querySelector('.check').onclick = async () => {
          try {
            await api(`/pug/api/goals/${g.id}`, { method: 'PATCH', body: { is_finished: true } });
            toast('Goal finished 🎉');
            loadDashGoals(); loadConsistency();
            document.dispatchEvent(new CustomEvent('veyra:goals-changed'));
          } catch (e) { toast(e.message, 'error'); }
        };
        wrap.appendChild(row);
      });
    }).catch(() => {});
  }

  // ── habits today count ─────────────────────────────────────
  function loadHabitCount() {
    api('/pug/api/habits').then(hs => {
      const done = hs.filter(h => h.done_today).length;
      $('#stHabits').textContent = hs.length ? `${done}/${hs.length}` : '0';
    }).catch(() => {});
  }

  // ── consistency bars ───────────────────────────────────────
  function loadConsistency() {
    api('/pug/api/consistency').then(days => {
      const wrap = $('#consistencyBars');
      wrap.innerHTML = '';
      const max = Math.max(1, ...days.map(d => Math.max(d.added, d.finished, d.dropped)));
      days.forEach(d => {
        const el = document.createElement('div');
        el.className = 'cbar';
        const h = v => Math.round((v / max) * 62);
        el.innerHTML = `
          <div class="bars">
            <div class="b add"  style="height:${h(d.added)}px"    title="added ${d.added}"></div>
            <div class="b fin"  style="height:${h(d.finished)}px" title="finished ${d.finished}"></div>
            <div class="b drop" style="height:${h(d.dropped)}px"  title="dropped ${d.dropped}"></div>
          </div>
          <div class="d">${esc(d.day)}</div>`;
        wrap.appendChild(el);
      });
    }).catch(() => {});
  }

  window.Veyra.when('dashboard', () => {
    loadStats(); loadDashGoals(); loadHabitCount(); loadConsistency();
  });
  document.addEventListener('veyra:goals-changed',  () => { loadDashGoals(); loadConsistency(); });
  document.addEventListener('veyra:habits-changed', loadHabitCount);
})();
