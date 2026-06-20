/**
 * calendar.js — interactive month calendar.
 *  • Click a date → add an event (title, optional time, optional span end date).
 *  • Event days are ENCIRCLED with a font colour that intensifies with how many
 *    events fall that day (busy day reads hotter). Holidays get a small dot.
 *  • Hover a marked day → shows the event/holiday name(s).
 *  • Official public holidays fetched by the viewer's country (browser locale)
 *    via our /pug/api/holidays proxy (Nager.Date).
 */
document.addEventListener('DOMContentLoaded', () => {
  const daysContainer = document.getElementById('calendarDays');
  const monthDisplay  = document.getElementById('monthDisplay');
  const prevBtn       = document.getElementById('prevMonth');
  const nextBtn       = document.getElementById('nextMonth');
  if (!daysContainer) return;

  let currentDate = new Date();
  let events   = [];               // [{id,title,start_datetime,end_datetime}]
  let holidays = {};               // 'YYYY-MM-DD' -> [name, ...]
  let habitPct = {};               // 'YYYY-MM-DD' -> habit completion % (last 90 days)
  const holidayYears = new Set();  // years already fetched

  // A past day where you crushed your habits (≥ this %) becomes a "window" onto a
  // hidden picture: each such day paints its own slice, so the image self-assembles
  // across the month as you stack good days. Swap REVEAL_IMAGE for any pic/meme/quote.
  const CRUSH_THRESHOLD = 80;
  const REVEAL_IMAGE = '/static/icons/icon-192.png';

  injectStyles();

  // ── data ────────────────────────────────────────────────────────────────
  window.refreshNexusCalendar = async function () {
    try {
      const res = await fetch('/pug/api/events');
      if (res.ok) events = await res.json();
    } catch (_) {}
    await loadHabitHistory();
    renderCalendar();
  };

  async function loadHabitHistory() {
    try {
      const res = await fetch('/pug/api/habits/history?days=90');
      if (!res.ok) return;
      const rows = await res.json();
      habitPct = {};
      rows.forEach(r => { if (r && r.date != null) habitPct[r.date] = r.pct; });
    } catch (_) {}
  }

  async function loadHolidays(year) {
    if (holidayYears.has(year)) return;
    holidayYears.add(year);
    const country = detectCountry();
    if (!country) return;
    try {
      const res = await fetch(`/pug/api/holidays?country=${country}&year=${year}`);
      if (!res.ok) return;
      const list = await res.json();
      list.forEach(h => {
        if (!h.date) return;
        (holidays[h.date] = holidays[h.date] || []).push(h.name);
      });
      renderCalendar();
    } catch (_) {}
  }

  // Timezone → ISO country. The IANA zone reflects where the user actually IS,
  // which the browser *language* often doesn't (e.g. an en-US locale in India was
  // pulling US holidays — July 4th, Juneteenth — that mean nothing there).
  const TZ_COUNTRY = {
    'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN',
    'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Colombo': 'LK', 'Asia/Kathmandu': 'NP',
    'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Asia/Jerusalem': 'IL', 'Asia/Tehran': 'IR',
    'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Shanghai': 'CN', 'Asia/Hong_Kong': 'HK',
    'Asia/Singapore': 'SG', 'Asia/Bangkok': 'TH', 'Asia/Jakarta': 'ID', 'Asia/Manila': 'PH',
    'Asia/Kuala_Lumpur': 'MY', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Taipei': 'TW',
    'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Berlin': 'DE', 'Europe/Paris': 'FR',
    'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE',
    'Europe/Vienna': 'AT', 'Europe/Zurich': 'CH', 'Europe/Lisbon': 'PT', 'Europe/Warsaw': 'PL',
    'Europe/Prague': 'CZ', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO', 'Europe/Helsinki': 'FI',
    'Europe/Copenhagen': 'DK', 'Europe/Athens': 'GR', 'Europe/Budapest': 'HU', 'Europe/Bucharest': 'RO',
    'Europe/Moscow': 'RU', 'Europe/Istanbul': 'TR', 'Europe/Kyiv': 'UA', 'Europe/Kiev': 'UA',
    'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
    'America/Los_Angeles': 'US', 'America/Phoenix': 'US', 'America/Anchorage': 'US',
    'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Mexico_City': 'MX',
    'America/Sao_Paulo': 'BR', 'America/Buenos_Aires': 'AR', 'America/Bogota': 'CO',
    'America/Santiago': 'CL', 'America/Lima': 'PE',
    'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Perth': 'AU',
    'Australia/Brisbane': 'AU', 'Pacific/Auckland': 'NZ',
    'Africa/Johannesburg': 'ZA', 'Africa/Cairo': 'EG', 'Africa/Lagos': 'NG', 'Africa/Nairobi': 'KE',
  };

  function detectCountry() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (TZ_COUNTRY[tz]) return TZ_COUNTRY[tz];
    } catch (_) {}
    // Fallback: region embedded in an explicit locale (e.g. 'en-GB' -> 'GB').
    const langs = navigator.languages || [navigator.language || ''];
    for (const l of langs) {
      const m = /[-_]([A-Za-z]{2})$/.exec(l || '');
      if (m) return m[1].toUpperCase();
    }
    return null;
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  const pad = n => String(n).padStart(2, '0');
  const dstr = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

  function eventsOn(dateStr) {
    return events.filter(e => {
      if (!e.start_datetime) return false;
      const s  = e.start_datetime.slice(0, 10);
      const en = (e.end_datetime || e.start_datetime).slice(0, 10);
      return dateStr >= s && dateStr <= en;
    });
  }

  function timeOf(e) {
    // start_datetime carries a time only if it isn't midnight.
    const t = (e.start_datetime || '').slice(11, 16);
    return (t && t !== '00:00') ? t : '';
  }

  // A past day counts as "crushed" if its habit completion cleared the threshold.
  function isCrushed(dateStr, todayStr) {
    const pct = habitPct[dateStr];
    return dateStr < todayStr && pct != null && pct >= CRUSH_THRESHOLD;
  }

  // Paint each crushed day with its slice of REVEAL_IMAGE: the image is sized to the
  // whole grid and offset by the cell's position, so the cells together reconstruct
  // the picture (circular "portholes"). Re-run on layout changes.
  function paintRevealSlices() {
    const cells = daysContainer.querySelectorAll('.calendar-day.crushed');
    cells.forEach(c => {
      c.style.backgroundImage    = `url("${REVEAL_IMAGE}")`;
      c.style.backgroundSize     = `${daysContainer.clientWidth}px ${daysContainer.clientHeight}px`;
      c.style.backgroundPosition = `-${c.offsetLeft}px -${c.offsetTop}px`;
      c.style.backgroundRepeat   = 'no-repeat';
    });
  }

  // ── render ──────────────────────────────────────────────────────────────
  function renderCalendar() {
    daysContainer.innerHTML = '';
    const year  = currentDate.getFullYear();
    const month = currentDate.getMonth();
    monthDisplay.textContent = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
    loadHolidays(year);

    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const todayStr = dstr(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement('div');
      empty.className = 'calendar-day empty';
      daysContainer.appendChild(empty);
    }

    for (let d = 1; d <= lastDate; d++) {
      const cell    = document.createElement('div');
      const dateStr = dstr(year, month, d);
      cell.className = 'calendar-day';
      cell.textContent = d;
      cell.dataset.date = dateStr;

      if (dateStr === todayStr) cell.classList.add('today');

      const evs   = eventsOn(dateStr);
      const holid = holidays[dateStr];

      // Past days fill in; the ones you crushed (≥ threshold) fill gold and hide a
      // reveal-puzzle (see openDayPopup).
      if (dateStr < todayStr) {
        cell.classList.add('past');
        if (isCrushed(dateStr, todayStr)) cell.classList.add('crushed');
      }

      if (evs.length) {
        cell.classList.add('has-ev', evs.length >= 3 ? 'ev3' : (evs.length === 2 ? 'ev2' : 'ev1'));
      }
      if (holid && holid.length) cell.classList.add('is-holiday');

      // Hover names (events first, then holidays).
      const tip = [];
      evs.forEach(e => tip.push((timeOf(e) ? timeOf(e) + ' ' : '') + e.title));
      if (holid) holid.forEach(n => tip.push('🎉 ' + n));
      if (isCrushed(dateStr, todayStr)) tip.push(`🧩 ${habitPct[dateStr]}% — tap to reveal`);
      if (tip.length) cell.title = tip.join('\n');

      cell.addEventListener('click', () => openDayPopup(dateStr));
      daysContainer.appendChild(cell);
    }

    paintRevealSlices();   // fill crushed cells with their image slices
  }

  // Re-slice when the sidebar/card resizes (cell offsets change).
  let _revealResizeT;
  window.addEventListener('resize', () => {
    clearTimeout(_revealResizeT);
    _revealResizeT = setTimeout(paintRevealSlices, 150);
  });

  // ── add/list popup for a day ────────────────────────────────────────────
  function openDayPopup(dateStr) {
    closePopup();
    const evs   = eventsOn(dateStr);
    const holid = holidays[dateStr] || [];
    const todayStr = dstr(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    const crushed  = isCrushed(dateStr, todayStr);
    const pretty = new Date(dateStr + 'T00:00').toLocaleDateString('default',
      { weekday: 'long', month: 'long', day: 'numeric' });

    const ov = document.createElement('div');
    ov.id = 'calPopup';
    ov.className = 'cal-pop-ov';
    ov.innerHTML = `
      <div class="cal-pop">
        <div class="cal-pop-head"><span>${pretty}</span>
          <button class="cal-pop-x" id="calPopClose" aria-label="Close">&times;</button></div>
        ${holid.map(n => `<div class="cal-pop-holiday">🎉 ${escapeHtml(n)}</div>`).join('')}
        ${crushed ? `<div class="cal-pop-reward">
            <div class="cal-pop-reward-top">🧩 ${habitPct[dateStr]}% crushed</div>
            <div class="cal-pop-riddle">You uncovered a piece of this month's picture — keep stacking good days to reveal the whole thing.</div>
          </div>` : ''}
        <div class="cal-pop-list" id="calPopList"></div>
        <div class="cal-pop-form">
          <input type="text" id="evTitle" placeholder="Add an event or plan…" autocomplete="off" maxlength="200">
          <div class="cal-pop-row">
            <label>Time<input type="time" id="evTime"></label>
            <label>Until<input type="date" id="evEnd" min="${dateStr}"></label>
          </div>
          <button class="cal-pop-add" id="evAdd">Add</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) closePopup(); });
    document.getElementById('calPopClose').onclick = closePopup;

    renderPopList(dateStr, evs);

    const add = () => addEvent(dateStr);
    document.getElementById('evAdd').onclick = add;
    const t = document.getElementById('evTitle');
    t.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    t.focus();
  }

  function renderPopList(dateStr, evs) {
    const list = document.getElementById('calPopList');
    if (!list) return;
    if (!evs.length) { list.innerHTML = '<div class="cal-pop-empty">No events yet.</div>'; return; }
    list.innerHTML = '';
    evs.forEach(e => {
      const row = document.createElement('div');
      row.className = 'cal-pop-item';
      const span = (e.end_datetime && e.end_datetime.slice(0, 10) !== e.start_datetime.slice(0, 10))
        ? ` → ${e.end_datetime.slice(0, 10)}` : '';
      const lbl = document.createElement('span');
      lbl.textContent = (timeOf(e) ? timeOf(e) + '  ' : '') + e.title + span;
      const del = document.createElement('button');
      del.className = 'cal-pop-del'; del.textContent = '×'; del.title = 'Delete';
      del.onclick = () => deleteEvent(e.id, dateStr);
      row.appendChild(lbl); row.appendChild(del);
      list.appendChild(row);
    });
  }

  async function addEvent(dateStr) {
    const title = (document.getElementById('evTitle').value || '').trim();
    if (!title) return;
    const time = document.getElementById('evTime').value || '';
    const end  = document.getElementById('evEnd').value || '';
    try {
      const res = await fetch('/pug/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title, start: dateStr, end, time }),
      });
      if (!res.ok) return;
      await window.refreshNexusCalendar();
      if (window.veyraHeaderBar) window.veyraHeaderBar.refresh();
      renderPopList(dateStr, eventsOn(dateStr));
      const t = document.getElementById('evTitle');
      if (t) { t.value = ''; t.focus(); }
      const tm = document.getElementById('evTime'); if (tm) tm.value = '';
      const en = document.getElementById('evEnd');  if (en) en.value = '';
    } catch (_) {}
  }

  async function deleteEvent(id, dateStr) {
    try {
      const res = await fetch(`/pug/api/events/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) return;
      await window.refreshNexusCalendar();
      if (window.veyraHeaderBar) window.veyraHeaderBar.refresh();
      renderPopList(dateStr, eventsOn(dateStr));
    } catch (_) {}
  }

  function closePopup() { const p = document.getElementById('calPopup'); if (p) p.remove(); }
  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ── controls ────────────────────────────────────────────────────────────
  if (prevBtn) prevBtn.onclick = e => { e.preventDefault(); currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); };
  if (nextBtn) nextBtn.onclick = e => { e.preventDefault(); currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); };

  // ── styles ────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('calStyles')) return;
    const s = document.createElement('style');
    s.id = 'calStyles';
    s.textContent = `
      .calendar-days{position:relative}
      .calendar-day{cursor:pointer;border-radius:50%;transition:background .15s}
      .calendar-day:not(.empty):hover{background:var(--surface-2,#23252c)}
      /* past days fill in faintly; a "crushed" day (high habit completion) becomes a
         porthole onto the hidden picture (its image slice is painted inline by JS) */
      .calendar-day.past:not(.crushed):not(.has-ev){background:rgba(255,255,255,.04);color:var(--text-dim,#7d828c)}
      .calendar-day.crushed{position:relative;color:#fff;font-weight:700;
        text-shadow:0 1px 3px rgba(0,0,0,.9),0 0 2px rgba(0,0,0,.95);
        box-shadow:inset 0 0 0 1.5px rgba(255,210,122,.7),0 0 8px rgba(224,162,60,.35)}
      /* event days: encircle the number + colour the font, hotter as it gets busier */
      .calendar-day.has-ev{position:relative;font-weight:700}
      .calendar-day.ev1{color:#e0a23c;box-shadow:inset 0 0 0 1.5px rgba(224,162,60,.6)}
      .calendar-day.ev2{color:#e8842f;box-shadow:inset 0 0 0 1.5px rgba(232,132,47,.8)}
      .calendar-day.ev3{color:#e2533f;box-shadow:inset 0 0 0 2px rgba(226,83,63,.95)}
      /* holiday: small dot under the number */
      .calendar-day.is-holiday::after{content:'';position:absolute;bottom:3px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:#3ea37a}
      .calendar-day.is-holiday{position:relative;color:#3ea37a}
      .calendar-day.is-holiday.has-ev{color:#e8842f}

      .cal-pop-ov{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)}
      .cal-pop{width:440px;max-width:94vw;background:var(--surface-1,#15161a);color:var(--text,#e6e6e6);border:1px solid var(--border2,#2a2c33);border-radius:16px;padding:24px 26px;box-shadow:0 18px 60px rgba(0,0,0,.5)}
      .cal-pop-head{display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:18px;margin-bottom:16px}
      .cal-pop-x{background:none;border:none;color:var(--text-dim,#9aa0aa);font-size:26px;cursor:pointer;line-height:1}
      .cal-pop-holiday{font-size:14px;color:#3ea37a;margin-bottom:10px}
      .cal-pop-reward{background:linear-gradient(135deg,rgba(224,162,60,.14),rgba(232,132,47,.08));border:1px solid rgba(224,162,60,.4);border-radius:12px;padding:13px 15px;margin-bottom:16px}
      .cal-pop-reward-top{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#e0a23c;margin-bottom:8px}
      .cal-pop-riddle{font-size:13.5px;line-height:1.5;color:var(--text-dim,#9aa0aa)}
      .cal-pop-list{display:flex;flex-direction:column;gap:8px;margin-bottom:18px;max-height:240px;overflow-y:auto}
      .cal-pop-empty{font-size:14px;color:var(--text-dim,#7d828c)}
      .cal-pop-item{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:15px;background:var(--surface-2,#1d1f25);border-radius:9px;padding:10px 13px}
      .cal-pop-del{background:none;border:none;color:var(--text-dim,#9aa0aa);cursor:pointer;font-size:20px;line-height:1}
      .cal-pop-del:hover{color:#e2533f}
      .cal-pop-form{display:flex;flex-direction:column;gap:11px}
      .cal-pop-form input[type=text]{padding:12px 14px;border-radius:10px;border:1px solid var(--border2,#2a2c33);background:var(--surface-2,#1d1f25);color:var(--text,#e6e6e6);font-size:15px}
      .cal-pop-row{display:flex;gap:11px}
      .cal-pop-row label{flex:1;display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--text-dim,#9aa0aa)}
      .cal-pop-row input{padding:10px 11px;border-radius:9px;border:1px solid var(--border2,#2a2c33);background:var(--surface-2,#1d1f25);color:var(--text,#e6e6e6);font-size:14px;color-scheme:dark}
      .cal-pop-add{padding:12px;border-radius:10px;border:none;background:var(--accent,#6c8cff);color:#fff;font-weight:600;font-size:15px;cursor:pointer}
      .cal-pop-add:hover{opacity:.9}`;
    document.head.appendChild(s);
  }

  // start
  window.refreshNexusCalendar();
});
