/*
 * headerbar.js — fills the header slot (formerly the "Dream" bar) with either the
 * next upcoming calendar event ("Deadline"), a wisdom quote, or both swapping on a
 * ~5-minute timer. Controlled by the "Header Bar" profile setting (localStorage:
 * veyra_header_bar = 'wisdom' | 'deadline' | 'both', default 'both').
 *
 * "Next deadline" = the soonest calendar event whose date is today-or-later
 * (events come from /pug/api/events; an event with an end_datetime is a span).
 */
(function () {
  const KEY      = 'veyra_header_bar';
  const SWAP_MS  = 5 * 60 * 1000;     // swap wisdom <-> deadline every ~5 min in 'both'
  const slot     = document.getElementById('dreamContainer');
  if (!slot) return;

  const offlineMix = [
    "Discipline equals freedom. - Jocko Willink",
    "The obstacle is the way. - Marcus Aurelius",
    "We suffer more often in imagination than in reality. - Seneca",
    "Amateurs sit and wait for inspiration, the rest of us just get up and go to work. - Stephen King",
  ];

  let nextEvent  = null;     // {id,title,start,end} or null
  let wisdomText = '';
  let swapTimer  = null;
  let bothShow   = 'deadline';   // which face is visible while mode === 'both'

  const ICON = '<svg class="hdr-dl-ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h12M6 22h12M6 2c0 4 4 5 6 8 2-3 6-4 6-8M6 22c0-4 4-5 6-8 2 3 6 4 6 8"/></svg>';

  function getMode() {
    const m = localStorage.getItem(KEY);
    return (m === 'wisdom' || m === 'deadline' || m === 'both') ? m : 'both';
  }

  // ── data ───────────────────────────────────────────────────────────────────
  async function loadNextEvent() {
    try {
      const res = await fetch('/pug/api/events', { credentials: 'include' });
      if (!res.ok) return;
      const events = await res.json();
      const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
      const t0 = todayMid.getTime();
      nextEvent = events
        .filter(e => e.start_datetime)
        .map(e => {
          const start = new Date(e.start_datetime);
          const end   = e.end_datetime ? new Date(e.end_datetime) : null;
          return { id: e.id, title: e.title, start, end };
        })
        // keep events still relevant today or in the future (span end, else start)
        .filter(e => {
          const tail = e.end || e.start;
          const tailMid = new Date(tail); tailMid.setHours(0, 0, 0, 0);
          return tailMid.getTime() >= t0;
        })
        .sort((a, b) => a.start - b.start)[0] || null;
    } catch (_) { /* leave previous value */ }
  }

  async function loadWisdom() {
    try {
      const res  = await fetch('/pug/api/wisdom');
      const data = await res.json();
      if (data && data.text) { wisdomText = data.text; return; }
      throw new Error('empty');
    } catch (_) {
      wisdomText = offlineMix[Math.floor(Math.random() * offlineMix.length)];
    }
  }

  // ── formatting ──────────────────────────────────────────────────────────────
  function fmtWhen(ev) {
    const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
    const startMid = new Date(ev.start); startMid.setHours(0, 0, 0, 0);
    const dayDiff  = Math.round((startMid - todayMid) / 86400000);
    const hasTime  = ev.start.getHours() !== 0 || ev.start.getMinutes() !== 0;
    const time     = hasTime
      ? ev.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : '';

    // currently inside a multi-day span
    if (ev.end) {
      const endMid = new Date(ev.end); endMid.setHours(0, 0, 0, 0);
      if (startMid <= todayMid && endMid >= todayMid) return 'Now';
    }
    if (dayDiff <= 0) return time ? `Today · ${time}` : 'Today';
    if (dayDiff === 1) return time ? `Tomorrow · ${time}` : 'Tomorrow';
    if (dayDiff < 7) {
      const wd = ev.start.toLocaleDateString([], { weekday: 'long' });
      return time ? `${wd} · ${time}` : wd;
    }
    const d = ev.start.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return time ? `${d} · ${time}` : d;
  }

  function esc(s) {
    return (s || '').replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ── render ────────────────────────────────────────────────────────────────
  function renderDeadline() {
    if (!nextEvent) {
      slot.innerHTML = `<span class="hdr-dl-empty">No upcoming deadlines</span>`;
      return;
    }
    slot.innerHTML =
      `<span class="hdr-deadline" title="${esc(nextEvent.title)}">` +
      ICON +
      `<span class="hdr-dl-title">${esc(nextEvent.title)}</span>` +
      `<span class="hdr-dl-when">${esc(fmtWhen(nextEvent))}</span>` +
      `</span>`;
  }

  function renderWisdom() {
    slot.innerHTML = `<span class="hdr-wisdom">${esc(wisdomText)}</span>`;
  }

  function render() {
    const mode = getMode();
    if (mode === 'wisdom') return renderWisdom();
    if (mode === 'deadline') return renderDeadline();
    // both: show whichever face is active; fall back to the other if empty
    if (bothShow === 'deadline') {
      if (nextEvent) return renderDeadline();
      return renderWisdom();
    }
    return wisdomText ? renderWisdom() : renderDeadline();
  }

  function startSwap() {
    clearInterval(swapTimer);
    if (getMode() !== 'both') return;
    swapTimer = setInterval(() => {
      bothShow = (bothShow === 'deadline') ? 'wisdom' : 'deadline';
      render();
    }, SWAP_MS);
  }

  // ── public API (profile.js / calendar.js hooks) ─────────────────────────────
  window.veyraHeaderBar = {
    setMode(mode) {
      localStorage.setItem(KEY, mode);
      bothShow = 'deadline';
      render();
      startSwap();
    },
    async refresh() {        // call after events change so the deadline stays fresh
      await loadNextEvent();
      render();
    },
  };

  // ── boot ────────────────────────────────────────────────────────────────────
  (async function init() {
    await Promise.all([loadNextEvent(), loadWisdom()]);
    render();
    startSwap();
    // keep the deadline current (date rolls over, new events) without a swap
    setInterval(loadNextEvent, SWAP_MS);
  })();
})();
