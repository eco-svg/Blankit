/**
 * physique.js — Physique tab. Log body measurements over time and see a digital
 * mannequin (2D SVG) built from them; compare against an earlier date. No photos are
 * stored — the figure is rendered purely from the numbers. Live-camera measurement is
 * a later step. Backend: /pug/api/physique (GET/POST/DELETE).
 */
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var fieldsEl  = document.getElementById('physFields');
    if (!fieldsEl) return;
    var saveBtn   = document.getElementById('physSaveBtn');
    var scanBtn   = document.getElementById('physScanBtn');
    var msgEl     = document.getElementById('physMsg');
    var compareEl = document.getElementById('physCompareSelect');
    var deltasEl  = document.getElementById('physDeltas');
    var mannequin = document.getElementById('physMannequin');
    var cap       = document.getElementById('physMannequinCap');

    // field key → [label, unit, placeholder]
    var FIELDS = [
      ['height',    'Height',    'cm'],
      ['weight',    'Weight',    'kg'],
      ['neck',      'Neck',      'cm'],
      ['shoulders', 'Shoulders', 'cm'],
      ['chest',     'Chest',     'cm'],
      ['waist',     'Waist',     'cm'],
      ['hips',      'Hips',      'cm'],
      ['arm',       'Arm',       'cm'],
      ['thigh',     'Thigh',     'cm'],
      ['calf',      'Calf',      'cm']
    ];

    var logs = [];   // [{id, date, m}]

    // ── inputs ──
    fieldsEl.innerHTML = FIELDS.map(function (f) {
      return '<label class="phys-field"><span>' + f[1] + '</span>' +
             '<input type="number" inputmode="decimal" step="0.1" min="0" data-k="' + f[0] +
             '" placeholder="' + f[2] + '"></label>';
    }).join('');

    function inputs() { return fieldsEl.querySelectorAll('input[data-k]'); }
    function readInputs() {
      var m = {};
      inputs().forEach(function (i) {
        var v = parseFloat(i.value);
        if (!isNaN(v) && v > 0) m[i.dataset.k] = Math.round(v * 10) / 10;
      });
      return m;
    }
    function fillInputs(m) {
      inputs().forEach(function (i) { i.value = (m && m[i.dataset.k] != null) ? m[i.dataset.k] : ''; });
    }

    // ── mannequin (front-view parametric SVG silhouette) ──
    function map(v, inMin, inMax, outMin, outMax) {
      if (v == null || isNaN(v)) return (outMin + outMax) / 2;   // default mid when missing
      var t = (v - inMin) / (inMax - inMin);
      t = Math.max(0, Math.min(1, t));
      return outMin + t * (outMax - outMin);
    }
    // returns an SVG path/group string for a body; color sets the fill/stroke.
    function bodySVG(m, opts) {
      m = m || {};
      var cx = 100;
      var shHW  = map(m.shoulders, 90, 130, 26, 48);   // half-widths (px)
      var chHW  = map(m.chest,     80, 120, 22, 42);
      var wHW   = map(m.waist,     60, 110, 15, 40);
      var hipHW = map(m.hips,      80, 120, 22, 42);
      var armW  = map(m.arm,       22, 45,  5,  13);
      var thW   = map(m.thigh,     40, 72,  8,  17);
      var nkHW  = map(m.neck,      30, 45,  6,  10);
      // vertical anchors
      var headR = 17, headCY = 28, neckY = 46, shY = 58, chY = 92, wY = 150, hipY = 188,
          kneeY = 290, footY = 372;
      // torso outline (left side top→bottom, then right side bottom→top)
      var torso =
        'M' + (cx - nkHW) + ',' + neckY +
        ' L' + (cx - shHW) + ',' + shY +
        ' L' + (cx - chHW) + ',' + chY +
        ' L' + (cx - wHW)  + ',' + wY +
        ' L' + (cx - hipHW)+ ',' + hipY +
        ' L' + (cx + hipHW)+ ',' + hipY +
        ' L' + (cx + wHW)  + ',' + wY +
        ' L' + (cx + chHW) + ',' + chY +
        ' L' + (cx + shHW) + ',' + shY +
        ' L' + (cx + nkHW) + ',' + neckY + ' Z';
      // legs (hips → feet), arms (shoulders → hips level)
      var legL = 'M' + (cx - hipHW) + ',' + hipY + ' L' + (cx - thW - 2) + ',' + kneeY +
                 ' L' + (cx - 4) + ',' + footY + ' L' + (cx - 2) + ',' + hipY + ' Z';
      var legR = 'M' + (cx + hipHW) + ',' + hipY + ' L' + (cx + thW + 2) + ',' + kneeY +
                 ' L' + (cx + 4) + ',' + footY + ' L' + (cx + 2) + ',' + hipY + ' Z';
      var armL = 'M' + (cx - shHW) + ',' + shY + ' L' + (cx - shHW - armW) + ',' + (shY + 6) +
                 ' L' + (cx - chHW - armW) + ',' + (wY) + ' L' + (cx - chHW) + ',' + (wY - 6) + ' Z';
      var armR = 'M' + (cx + shHW) + ',' + shY + ' L' + (cx + shHW + armW) + ',' + (shY + 6) +
                 ' L' + (cx + chHW + armW) + ',' + (wY) + ' L' + (cx + chHW) + ',' + (wY - 6) + ' Z';
      var fill = opts.fill, stroke = opts.stroke, sw = opts.sw || 0, op = (opts.opacity != null ? opts.opacity : 1);
      var attrs = 'fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + sw + '"' : '') +
                  ' opacity="' + op + '" stroke-linejoin="round"';
      return '<circle cx="' + cx + '" cy="' + headCY + '" r="' + headR + '" ' + attrs + '/>' +
             '<path d="' + armL + '" ' + attrs + '/><path d="' + armR + '" ' + attrs + '/>' +
             '<path d="' + legL + '" ' + attrs + '/><path d="' + legR + '" ' + attrs + '/>' +
             '<path d="' + torso + '" ' + attrs + '/>';
    }
    function renderMannequin(current, ghost) {
      var parts = '';
      if (ghost) parts += bodySVG(ghost, { fill: 'none', stroke: 'var(--text-dim)', sw: 1.4, opacity: 0.55 });
      if (current) parts += bodySVG(current, { fill: 'var(--accent)', opacity: 0.9 });
      mannequin.innerHTML = current
        ? '<svg viewBox="0 0 200 400" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">' + parts + '</svg>'
        : '';
    }

    // ── comparison ──
    function renderCompareOptions() {
      if (logs.length < 2) {
        compareEl.innerHTML = '<option value="">— need a 2nd entry —</option>';
        compareEl.disabled = true;
        deltasEl.innerHTML = '';
        return;
      }
      compareEl.disabled = false;
      // all but the latest, newest first
      var opts = logs.slice(0, -1).reverse().map(function (l) {
        return '<option value="' + l.id + '">' + fmtDate(l.date) + '</option>';
      });
      compareEl.innerHTML = '<option value="">— none —</option>' + opts.join('');
    }
    function renderDeltas(thenM, nowM) {
      if (!thenM) { deltasEl.innerHTML = ''; return; }
      var rows = FIELDS.filter(function (f) { return nowM[f[0]] != null && thenM[f[0]] != null; })
        .map(function (f) {
          var d = Math.round((nowM[f[0]] - thenM[f[0]]) * 10) / 10;
          var cls = d > 0 ? 'up' : (d < 0 ? 'down' : '');
          var sign = d > 0 ? '+' : '';
          return '<div class="phys-delta ' + cls + '"><span>' + f[1] + '</span><span>' +
                 sign + d + ' ' + f[2] + '</span></div>';
        });
      deltasEl.innerHTML = rows.length ? rows.join('') : '<div class="phys-msg">No overlapping fields.</div>';
    }
    function latest() { return logs.length ? logs[logs.length - 1] : null; }
    function logById(id) { for (var i = 0; i < logs.length; i++) if (String(logs[i].id) === String(id)) return logs[i]; return null; }

    function refreshView() {
      var cur = latest();
      fillInputs(cur ? cur.m : {});
      renderCompareOptions();
      var ghostLog = compareEl.value ? logById(compareEl.value) : null;
      renderMannequin(cur ? cur.m : null, ghostLog ? ghostLog.m : null);
      renderDeltas(ghostLog ? ghostLog.m : null, cur ? cur.m : {});
      cap.textContent = cur ? ('Updated ' + fmtDate(cur.date)) : 'Add measurements to build your figure';
    }

    function fmtDate(iso) {
      if (!iso) return '';
      try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
      catch (e) { return iso.slice(0, 10); }
    }

    // ── data ──
    function load() {
      fetch('/pug/api/physique').then(function (r) { return r.json(); }).then(function (d) {
        logs = Array.isArray(d) ? d : [];
        refreshView();
      }).catch(function () {});
    }
    saveBtn && saveBtn.addEventListener('click', function () {
      var m = readInputs();
      if (!Object.keys(m).length) { msg('Enter at least one measurement.'); return; }
      saveBtn.disabled = true;
      fetch('/pug/api/physique', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m)
      }).then(function (r) { return r.json(); }).then(function (res) {
        saveBtn.disabled = false;
        if (res && res.error) { msg(res.error); return; }
        msg('Saved ✓'); load();
      }).catch(function () { saveBtn.disabled = false; msg('Save failed.'); });
    });
    compareEl && compareEl.addEventListener('change', refreshView);
    scanBtn && scanBtn.addEventListener('click', function () {
      msg('Live camera measure is coming soon — nothing will be recorded or stored.');
    });
    function msg(t) { if (msgEl) { msgEl.textContent = t; setTimeout(function () { if (msgEl.textContent === t) msgEl.textContent = ''; }, 3000); } }

    // load when the tab is opened (and once now in case it's the landing tab)
    document.addEventListener('veyra:navigate', function (e) { if (e.detail && e.detail.route === 'physique') load(); });
    load();
  });
})();
