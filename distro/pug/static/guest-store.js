/**
 * guest-store.js — local data layer for guest mode.
 *
 * When window.VEYRA_GUEST is set, this overrides window.fetch and answers the
 * PERSONAL CRUD endpoints (notes, to-do/goals, habits) from localStorage instead
 * of the server — so a logged-out guest can actually USE those tools. Their data
 * lives only in this browser; it's never sent to Veyra. Sign up = save it for real.
 *
 * Social / money endpoints (community, DMs, wallet) are NOT intercepted — they hit
 * the server and 401, and guest.js turns those into a "sign up" prompt.
 *
 * Loads early (before the feature scripts) so every later fetch is intercepted.
 */
(function () {
  if (!window.VEYRA_GUEST) return;

  var K = { notes:'veyra_guest_notes', goals:'veyra_guest_goals', events:'veyra_guest_events',
            habits:'veyra_guest_habits', logs:'veyra_guest_habit_logs', seq:'veyra_guest_seq' };

  function read(k, def) { try { return JSON.parse(localStorage.getItem(k)) || def; } catch (_) { return def; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  function nextId() { var n = (parseInt(localStorage.getItem(K.seq), 10) || 0) + 1; localStorage.setItem(K.seq, String(n)); return n; }
  function nowISO() { return new Date().toISOString(); }
  function dstr(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
  function json(obj, status) {
    return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  }

  function handle(method, path, body) {
    // ── NOTES ──
    if (path === '/pug/api/notes') {
      if (method === 'GET') return json(read(K.notes, []).filter(function (n){ return !n.is_deleted; }));
      if (method === 'POST') {
        var notes = read(K.notes, []);
        if (body.id) {
          var n = notes.filter(function (x){ return x.id === body.id; })[0];
          if (!n) return json({ status:'error', message:'Not found' }, 404);
          n.title = body.title || ''; n.body = body.body || '';
          n.start_datetime = body.start_datetime || null; n.updated_at = nowISO();
          write(K.notes, notes); return json({ status:'success', id:n.id });
        }
        var nn = { id: nextId(), title: body.title||'', body: body.body||'', entry_type:'note',
                   is_finished:false, start_datetime: body.start_datetime||null, end_datetime:null,
                   created_at: nowISO(), updated_at: nowISO(), is_deleted:false };
        notes.unshift(nn); write(K.notes, notes); return json({ status:'success', id:nn.id });
      }
    }
    var mNote = path.match(/^\/pug\/api\/notes\/(\d+)$/);
    if (mNote && method === 'DELETE') {
      var nid = +mNote[1], notes2 = read(K.notes, []);
      notes2.forEach(function (n){ if (n.id === nid) n.is_deleted = true; });
      write(K.notes, notes2); return json({ status:'success' });
    }

    // ── GOALS / TO-DO ──
    if (path === '/pug/api/goals/cancelled' && method === 'GET') {
      return json(read(K.goals, []).filter(function (g){ return g.is_deleted && !g.is_finished; }).reverse().slice(0,20));
    }
    if (path === '/pug/api/goals') {
      if (method === 'GET') return json(read(K.goals, []).filter(function (g){ return !g.is_deleted; }));
      if (method === 'POST') {
        var title = (body.title||'').trim(); if (!title) return json({ status:'error' }, 400);
        var goals = read(K.goals, []);
        var g = { id: nextId(), title:title, entry_type:'goal', is_finished:false, is_deleted:false,
                  created_at: nowISO(), updated_at: nowISO() };
        goals.push(g); write(K.goals, goals); return json({ status:'success', id:g.id });
      }
    }
    var mGoal = path.match(/^\/pug\/api\/goals\/(\d+)$/);
    if (mGoal) {
      var gid = +mGoal[1], goals2 = read(K.goals, []), gg = goals2.filter(function (x){ return x.id === gid; })[0];
      if (method === 'PATCH') {
        if (gg && ('is_finished' in body)) { gg.is_finished = body.is_finished; gg.updated_at = nowISO(); write(K.goals, goals2); }
        return json({ status:'success' });
      }
      if (method === 'DELETE') {
        if (gg) { gg.is_deleted = true; gg.updated_at = nowISO(); write(K.goals, goals2); }
        return json({ status:'success' });
      }
    }

    // ── CALENDAR EVENTS ──
    if (path === '/pug/api/events') {
      if (method === 'GET') {
        return json(read(K.events, []).filter(function (e){ return !e.is_deleted; })
          .sort(function (a,b){ return (a.start_datetime||'').localeCompare(b.start_datetime||''); })
          .map(function (e){ return { id:e.id, title:e.title, start_datetime:e.start_datetime, end_datetime:e.end_datetime }; }));
      }
      if (method === 'POST') {
        var title = (body.title||'').trim(), start = (body.start||'').trim();
        if (!title || !start) return json({ error:'title and start required' }, 400);
        var tm = (body.time||'').trim(), end = (body.end||'').trim();
        var sdt = start + 'T' + (tm ? (tm.length === 5 ? tm + ':00' : tm) : '00:00:00');
        var edt = end ? (end + 'T00:00:00') : null;
        if (edt && edt.slice(0,10) < sdt.slice(0,10)) return json({ error:'end before start' }, 400);
        var evs = read(K.events, []);
        var e = { id: nextId(), title:title, start_datetime:sdt, end_datetime:edt, is_deleted:false };
        evs.push(e); write(K.events, evs);
        return json({ id:e.id, title:e.title, start_datetime:e.start_datetime, end_datetime:e.end_datetime });
      }
    }
    var mEv = path.match(/^\/pug\/api\/events\/(\d+)$/);
    if (mEv && method === 'DELETE') {
      var eid = +mEv[1], evs2 = read(K.events, []);
      evs2.forEach(function (e){ if (e.id === eid) e.is_deleted = true; });
      write(K.events, evs2); return json({ ok:true });
    }

    // ── HABITS ──
    var hbase = path.split('?')[0];
    if (hbase === '/pug/api/habits') {
      if (method === 'GET') {
        var logs = read(K.logs, {}), today = dstr(new Date());
        return json(read(K.habits, []).filter(function (h){ return h.is_active; }).map(function (h){
          return Object.assign({}, h, { done_today: !!(logs[today] && logs[today][h.id]) });
        }));
      }
      if (method === 'POST') {
        var name = (body.name||'').trim().slice(0,120); if (!name) return json({ error:'name required' }, 400);
        var hs = read(K.habits, []);
        var h = { id: nextId(), user_id:0, name:name, track_type:'binary', created_at: nowISO(), is_active:true };
        hs.push(h); write(K.habits, hs); return json(h, 201);
      }
    }
    var mHabit = path.match(/^\/pug\/api\/habits\/(\d+)$/);
    if (mHabit && method === 'DELETE') {
      write(K.habits, read(K.habits, []).filter(function (h){ return h.id !== +mHabit[1]; }));
      return json({ ok:true });
    }
    var mTog = path.match(/^\/pug\/api\/habits\/(\d+)\/toggle$/);
    if (mTog && method === 'POST') {
      var hid = +mTog[1], logs2 = read(K.logs, {}), t = dstr(new Date());
      logs2[t] = logs2[t] || {}; logs2[t][hid] = !logs2[t][hid];
      write(K.logs, logs2); return json({ done: logs2[t][hid] });
    }
    if (hbase === '/pug/api/habits/history' && method === 'GET') {
      var q = path.split('?')[1] || '', dm = q.match(/days=(\d+)/), days = dm ? Math.min(+dm[1], 90) : 30;
      var hs3 = read(K.habits, []).filter(function (h){ return h.is_active; }), logs3 = read(K.logs, {}), out = [], base = new Date();
      for (var i = days - 1; i >= 0; i--) {
        var d = new Date(base); d.setDate(base.getDate() - i); var ds = dstr(d), dayLog = logs3[ds] || {}, done = 0;
        hs3.forEach(function (h){ if (dayLog[h.id]) done++; });
        out.push({ date: ds, pct: hs3.length ? Math.round((done/hs3.length)*100) : 0 });
      }
      return json(out);
    }

    return null;  // not a personal endpoint → let it pass through to the server
  }

  var _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      var path = url.replace(/^https?:\/\/[^/]+/, '');
      if (path.indexOf('/pug/api/') === 0) {
        var body = {};
        if (init && init.body) { try { body = JSON.parse(init.body); } catch (_) {} }
        var res = handle(method, path, body);
        if (res) return Promise.resolve(res);
      }
    } catch (_) {}
    return _fetch(input, init);
  };
})();
