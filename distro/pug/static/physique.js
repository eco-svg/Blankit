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

    // ── Live camera measure (on-device MediaPipe pose). Nothing is recorded or stored:
    //    frames are processed live and discarded; only the resulting numbers are kept. ──
    var camOverlay = document.getElementById('physCamOverlay');
    var camVideo   = document.getElementById('physCamVideo');
    var camCanvas  = document.getElementById('physCamCanvas');
    var camStatus  = document.getElementById('physCamStatus');
    var camMeasure = document.getElementById('physCamMeasure');
    var camClose   = document.getElementById('physCamClose');
    var poseLm = null, camStream = null, rafId = null, lastLm = null;

    function heightVal() {
      var h = null;
      inputs().forEach(function (i) { if (i.dataset.k === 'height') h = parseFloat(i.value); });
      return (h && h > 50 && h < 260) ? h : null;
    }
    async function ensurePose() {
      if (poseLm) return poseLm;
      camStatus.textContent = 'Loading model…';
      var V = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12';
      var vision = await import(V);
      var fileset = await vision.FilesetResolver.forVisionTasks(V + '/wasm');
      poseLm = await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' },
        runningMode: 'VIDEO', numPoses: 1
      });
      return poseLm;
    }
    async function openCam() {
      if (!camOverlay) return;
      if (!heightVal()) {
        msg('Enter your Height first — it calibrates the measurements.');
        var hi = fieldsEl.querySelector('input[data-k="height"]'); if (hi) hi.focus();
        return;
      }
      camOverlay.classList.remove('hidden');
      camStatus.textContent = 'Starting…'; camMeasure.disabled = true; lastLm = null;
      try {
        await ensurePose();
        camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
        camVideo.srcObject = camStream; await camVideo.play();
        camStatus.textContent = 'Stand back — fit your whole body in frame.';
        loop();
      } catch (e) {
        camStatus.textContent = 'Couldn’t start: ' + ((e && e.message) || 'camera/model unavailable') + '.';
      }
    }
    var CONNECT = [[11,12],[11,23],[12,24],[23,24],[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[24,26],[26,28]];
    function loop() {
      if (!camStream) return;
      var vw = camVideo.videoWidth, vh = camVideo.videoHeight;
      if (vw && vh) {
        camCanvas.width = vw; camCanvas.height = vh;
        var res = null;
        try { res = poseLm.detectForVideo(camVideo, performance.now()); } catch (e) {}
        var ctx = camCanvas.getContext('2d'); ctx.clearRect(0, 0, vw, vh);
        if (res && res.landmarks && res.landmarks[0]) {
          lastLm = res.landmarks[0];
          ctx.strokeStyle = 'rgba(212,165,116,0.9)'; ctx.lineWidth = 3;
          CONNECT.forEach(function (c) {
            var a = lastLm[c[0]], b = lastLm[c[1]]; if (!a || !b) return;
            ctx.beginPath(); ctx.moveTo(a.x * vw, a.y * vh); ctx.lineTo(b.x * vw, b.y * vh); ctx.stroke();
          });
          ctx.fillStyle = '#fff';
          lastLm.forEach(function (p) { ctx.beginPath(); ctx.arc(p.x * vw, p.y * vh, 3, 0, 7); ctx.fill(); });
          camMeasure.disabled = false; camStatus.textContent = 'Body detected — tap Measure.';
        } else { camMeasure.disabled = true; }
      }
      rafId = requestAnimationFrame(loop);
    }
    function dist(a, b, vw, vh) { var dx = (a.x - b.x) * vw, dy = (a.y - b.y) * vh; return Math.sqrt(dx * dx + dy * dy); }
    function measureFromPose() {
      var lm = lastLm, hCm = heightVal();
      if (!lm || !hCm) { msg('No body detected — try again.'); return; }
      var vw = camCanvas.width, vh = camCanvas.height;
      var bodyPx = Math.abs(((lm[27].y + lm[28].y) / 2) * vh - lm[0].y * vh);  // nose→ankle
      if (bodyPx < 20) { msg('Move back so your whole body is visible.'); return; }
      var cmPerPx = hCm / (bodyPx / 0.88);                 // nose→ankle ≈ 88% of full height
      var shW  = dist(lm[11], lm[12], vw, vh) * cmPerPx;   // shoulder width (cm)
      var hipW = dist(lm[23], lm[24], vw, vh) * cmPerPx;   // hip width (cm)
      // Rough front-view width→circumference proxies — APPROXIMATE, tune after live testing.
      var est = { shoulders: shW * 2.4, chest: shW * 2.2, waist: hipW * 2.3, hips: hipW * 2.7 };
      inputs().forEach(function (i) { if (est[i.dataset.k] != null) i.value = Math.round(est[i.dataset.k]); });
      closeCam();
      msg('Estimated from camera — adjust any number, then Save.');
    }
    function closeCam() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (camStream) { camStream.getTracks().forEach(function (t) { t.stop(); }); camStream = null; }
      if (camVideo) camVideo.srcObject = null;
      lastLm = null;
      if (camOverlay) camOverlay.classList.add('hidden');
    }
    scanBtn && scanBtn.addEventListener('click', openCam);
    camMeasure && camMeasure.addEventListener('click', measureFromPose);
    camClose && camClose.addEventListener('click', closeCam);
    function msg(t) { if (msgEl) { msgEl.textContent = t; setTimeout(function () { if (msgEl.textContent === t) msgEl.textContent = ''; }, 3000); } }

    // load when the tab is opened (and once now in case it's the landing tab)
    document.addEventListener('veyra:navigate', function (e) { if (e.detail && e.detail.route === 'physique') load(); });
    load();
  });
})();
