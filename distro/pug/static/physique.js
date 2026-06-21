/**
 * physique.js — Physique tab. Log body measurements over time → a digital mannequin
 * (2D SVG, or 3D via Three.js) built from the numbers; compare against an earlier date.
 * Live on-device camera measurement (MediaPipe pose) fills the numbers. NO photos are
 * ever stored — frames are processed live and discarded; only numbers persist.
 * Backend: /pug/api/physique (GET/POST/DELETE).
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
    var statsEl   = document.getElementById('physStats');
    var mannequin = document.getElementById('physMannequin');
    var mannequin3d = document.getElementById('physMannequin3d');
    var cap       = document.getElementById('physMannequinCap');
    var editorEl  = document.getElementById('physEditor');
    var figureEl  = document.getElementById('physFigure');
    var updateBtn = document.getElementById('physUpdateBtn');
    var dimBtn    = document.getElementById('physDimBtn');

    var FIELDS = [
      ['height','Height','cm'], ['weight','Weight','kg'], ['neck','Neck','cm'],
      ['shoulders','Shoulders','cm'], ['chest','Chest','cm'], ['waist','Waist','cm'],
      ['hips','Hips','cm'], ['arm','Arm','cm'], ['thigh','Thigh','cm'], ['calf','Calf','cm']
    ];
    var logs = [];          // [{id, date, m}]
    var mode3d = false;     // 2D by default

    fieldsEl.innerHTML = FIELDS.map(function (f) {
      return '<label class="phys-field"><span>' + f[1] + '</span>' +
             '<input type="number" inputmode="decimal" step="0.1" min="0" data-k="' + f[0] +
             '" placeholder="' + f[2] + '"></label>';
    }).join('');

    function inputs() { return fieldsEl.querySelectorAll('input[data-k]'); }
    function readInputs() {
      var m = {};
      inputs().forEach(function (i) { var v = parseFloat(i.value); if (!isNaN(v) && v > 0) m[i.dataset.k] = Math.round(v * 10) / 10; });
      return m;
    }
    function fillInputs(m) { inputs().forEach(function (i) { i.value = (m && m[i.dataset.k] != null) ? m[i.dataset.k] : ''; }); }
    function latest() { return logs.length ? logs[logs.length - 1] : null; }
    function logById(id) { for (var i = 0; i < logs.length; i++) if (String(logs[i].id) === String(id)) return logs[i]; return null; }
    function fmtDate(iso) { if (!iso) return ''; try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch (e) { return iso.slice(0, 10); } }
    function msg(t) { if (msgEl) { msgEl.textContent = t; setTimeout(function () { if (msgEl.textContent === t) msgEl.textContent = ''; }, 3000); } }

    // ── editor / figure switching ──
    function showEditor() { editorEl.classList.remove('hidden'); figureEl.classList.add('hidden'); }
    function showFigure() { editorEl.classList.add('hidden'); figureEl.classList.remove('hidden'); renderFigure(); }

    // ── stats (left) ──
    function renderStats(m) {
      if (!m || !Object.keys(m).length) { statsEl.innerHTML = '<div class="phys-msg">No measurements yet.</div>'; return; }
      statsEl.innerHTML = FIELDS.filter(function (f) { return m[f[0]] != null; }).map(function (f) {
        return '<div class="phys-stat-row"><span>' + f[1] + '</span><span>' + m[f[0]] + ' ' + f[2] + '</span></div>';
      }).join('');
    }

    // ── 2D mannequin ──
    function map(v, a, b, c, d) { if (v == null || isNaN(v)) return (c + d) / 2; var t = Math.max(0, Math.min(1, (v - a) / (b - a))); return c + t * (d - c); }
    function bodySVG(m, o) {
      m = m || {}; var cx = 100;
      var shHW = map(m.shoulders,90,130,26,48), chHW = map(m.chest,80,120,22,42), wHW = map(m.waist,60,110,15,40),
          hipHW = map(m.hips,80,120,22,42), armW = map(m.arm,22,45,5,13), thW = map(m.thigh,40,72,8,17), nkHW = map(m.neck,30,45,6,10);
      var neckY=46, shY=58, chY=92, wY=150, hipY=188, kneeY=290, footY=372;
      var torso='M'+(cx-nkHW)+','+neckY+' L'+(cx-shHW)+','+shY+' L'+(cx-chHW)+','+chY+' L'+(cx-wHW)+','+wY+' L'+(cx-hipHW)+','+hipY+
                ' L'+(cx+hipHW)+','+hipY+' L'+(cx+wHW)+','+wY+' L'+(cx+chHW)+','+chY+' L'+(cx+shHW)+','+shY+' L'+(cx+nkHW)+','+neckY+' Z';
      var legL='M'+(cx-hipHW)+','+hipY+' L'+(cx-thW-2)+','+kneeY+' L'+(cx-4)+','+footY+' L'+(cx-2)+','+hipY+' Z';
      var legR='M'+(cx+hipHW)+','+hipY+' L'+(cx+thW+2)+','+kneeY+' L'+(cx+4)+','+footY+' L'+(cx+2)+','+hipY+' Z';
      var armL='M'+(cx-shHW)+','+shY+' L'+(cx-shHW-armW)+','+(shY+6)+' L'+(cx-chHW-armW)+','+wY+' L'+(cx-chHW)+','+(wY-6)+' Z';
      var armR='M'+(cx+shHW)+','+shY+' L'+(cx+shHW+armW)+','+(shY+6)+' L'+(cx+chHW+armW)+','+wY+' L'+(cx+chHW)+','+(wY-6)+' Z';
      var a='fill="'+o.fill+'"'+(o.stroke?' stroke="'+o.stroke+'" stroke-width="'+o.sw+'"':'')+' opacity="'+(o.opacity!=null?o.opacity:1)+'" stroke-linejoin="round"';
      return '<circle cx="'+cx+'" cy="28" r="17" '+a+'/><path d="'+armL+'" '+a+'/><path d="'+armR+'" '+a+'/><path d="'+legL+'" '+a+'/><path d="'+legR+'" '+a+'/><path d="'+torso+'" '+a+'/>';
    }
    function render2D(cur, ghost) {
      var p = '';
      if (ghost) p += bodySVG(ghost, { fill:'none', stroke:'var(--text-dim)', sw:1.4, opacity:0.55 });
      if (cur) p += bodySVG(cur, { fill:'var(--accent)', opacity:0.9 });
      mannequin.innerHTML = cur ? '<svg viewBox="0 0 200 400" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">'+p+'</svg>' : '';
    }

    // ── 3D mannequin (Three.js, lazy) ──
    var THREE = null, three = {};   // {renderer, scene, camera, group, raf}
    async function ensureThree() {
      if (THREE) return THREE;
      THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
      return THREE;
    }
    function disposeThree() {
      if (three.raf) cancelAnimationFrame(three.raf);
      if (three.renderer) { three.renderer.dispose(); if (three.renderer.domElement && three.renderer.domElement.parentNode) three.renderer.domElement.parentNode.removeChild(three.renderer.domElement); }
      three = {};
    }
    function cyl(T, rt, rb, h, y, color) { var g = new T.CylinderGeometry(rt, rb, h, 20); var m = new T.Mesh(g, new T.MeshStandardMaterial({ color: color, roughness: 0.7 })); m.position.y = y; return m; }
    async function render3D(cur) {
      if (!cur) { mannequin3d.innerHTML = ''; return; }
      var T;
      try { T = await ensureThree(); } catch (e) { msg('3D unavailable — staying in 2D.'); mode3d = false; dimBtn.textContent = '3D'; swapDim(); return; }
      disposeThree();
      var w = mannequin3d.clientWidth || 280, h = mannequin3d.clientHeight || 420;
      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(40, w / h, 0.1, 100); camera.position.set(0, 0.2, 6);
      var renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(w, h); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      mannequin3d.innerHTML = ''; mannequin3d.appendChild(renderer.domElement);
      scene.add(new T.AmbientLight(0xffffff, 0.65));
      var dir = new T.DirectionalLight(0xffffff, 0.8); dir.position.set(2, 3, 4); scene.add(dir);
      var col = 0xd4a574;
      var g = new T.Group();
      var sh = map(cur.shoulders,90,130,0.5,0.95)/2, ch = map(cur.chest,80,120,0.45,0.85)/2,
          wa = map(cur.waist,60,110,0.32,0.78)/2, hip = map(cur.hips,80,120,0.45,0.85)/2,
          arm = map(cur.arm,22,45,0.07,0.17)/2, th = map(cur.thigh,40,72,0.10,0.22)/2;
      g.add(function(){ var s=new T.Mesh(new T.SphereGeometry(0.28,24,24), new T.MeshStandardMaterial({color:col,roughness:0.7})); s.position.y=2.0; return s; }());
      g.add(cyl(T, ch, hip, 1.7, 0.85, col));               // torso (chest→hips)
      g.add(cyl(T, sh*0.5, ch, 0.35, 1.85, col));           // upper chest/shoulders
      var aL=cyl(T,arm,arm,1.4,0.95,col); aL.position.x=-(sh+arm+0.02); g.add(aL);
      var aR=cyl(T,arm,arm,1.4,0.95,col); aR.position.x=(sh+arm+0.02); g.add(aR);
      var lL=cyl(T,th,th*0.7,1.7,-0.95,col); lL.position.x=-hip*0.5; g.add(lL);
      var lR=cyl(T,th,th*0.7,1.7,-0.95,col); lR.position.x=hip*0.5; g.add(lR);
      scene.add(g);
      three = { renderer: renderer, scene: scene, camera: camera, group: g };
      (function anim() { three.raf = requestAnimationFrame(anim); g.rotation.y += 0.012; renderer.render(scene, camera); })();
    }

    function swapDim() {
      mannequin.classList.toggle('hidden', mode3d);
      mannequin3d.classList.toggle('hidden', !mode3d);
      if (!mode3d) disposeThree();
    }

    // ── figure render (per current mode) ──
    function renderFigure() {
      var cur = latest();
      var ghost = compareEl.value ? logById(compareEl.value) : null;
      cap.textContent = cur ? ('Updated ' + fmtDate(cur.date)) : '';
      if (mode3d) { render3D(cur ? cur.m : null); }
      else { render2D(cur ? cur.m : null, ghost ? ghost.m : null); }
    }

    // ── comparison ──
    function renderCompareOptions() {
      if (logs.length < 2) { compareEl.innerHTML = '<option value="">— need a 2nd entry —</option>'; compareEl.disabled = true; deltasEl.innerHTML = ''; return; }
      compareEl.disabled = false;
      var opts = logs.slice(0, -1).reverse().map(function (l) { return '<option value="' + l.id + '">' + fmtDate(l.date) + '</option>'; });
      compareEl.innerHTML = '<option value="">— none —</option>' + opts.join('');
    }
    function renderDeltas(thenM, nowM) {
      if (!thenM) { deltasEl.innerHTML = ''; return; }
      var rows = FIELDS.filter(function (f) { return nowM[f[0]] != null && thenM[f[0]] != null; }).map(function (f) {
        var d = Math.round((nowM[f[0]] - thenM[f[0]]) * 10) / 10, cls = d > 0 ? 'up' : (d < 0 ? 'down' : ''), s = d > 0 ? '+' : '';
        return '<div class="phys-delta ' + cls + '"><span>' + f[1] + '</span><span>' + s + d + ' ' + f[2] + '</span></div>';
      });
      deltasEl.innerHTML = rows.length ? rows.join('') : '<div class="phys-msg">No overlapping fields.</div>';
    }

    function refreshView() {
      var cur = latest();
      renderStats(cur ? cur.m : null);
      renderCompareOptions();
      var ghost = compareEl.value ? logById(compareEl.value) : null;
      renderDeltas(ghost ? ghost.m : null, cur ? cur.m : {});
      if (cur && figureEl.classList.contains('hidden')) { fillInputs(cur.m); showFigure(); }
      else if (!cur) { fillInputs({}); showEditor(); }
      else { renderFigure(); }
    }

    // ── data ──
    function load() {
      fetch('/pug/api/physique').then(function (r) { return r.json(); }).then(function (d) { logs = Array.isArray(d) ? d : []; refreshView(); }).catch(function () {});
    }
    saveBtn && saveBtn.addEventListener('click', function () {
      var m = readInputs();
      if (!Object.keys(m).length) { msg('Enter at least one measurement.'); return; }
      saveBtn.disabled = true;
      fetch('/pug/api/physique', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) })
        .then(function (r) { return r.json(); }).then(function (res) {
          saveBtn.disabled = false;
          if (res && res.error) { msg(res.error); return; }
          load();
        }).catch(function () { saveBtn.disabled = false; msg('Save failed.'); });
    });
    updateBtn && updateBtn.addEventListener('click', function () { var cur = latest(); fillInputs(cur ? cur.m : {}); showEditor(); });
    dimBtn && dimBtn.addEventListener('click', function () { mode3d = !mode3d; dimBtn.textContent = mode3d ? '2D' : '3D'; swapDim(); if (!figureEl.classList.contains('hidden')) renderFigure(); });
    compareEl && compareEl.addEventListener('change', function () { var cur = latest(); var ghost = compareEl.value ? logById(compareEl.value) : null; renderDeltas(ghost ? ghost.m : null, cur ? cur.m : {}); if (!figureEl.classList.contains('hidden')) renderFigure(); });

    // ── Live camera measure (on-device MediaPipe pose; nothing stored) ──
    var camOverlay = document.getElementById('physCamOverlay'), camVideo = document.getElementById('physCamVideo'),
        camCanvas = document.getElementById('physCamCanvas'), camStatus = document.getElementById('physCamStatus'),
        camMeasure = document.getElementById('physCamMeasure'), camClose = document.getElementById('physCamClose');
    var poseLm = null, camStream = null, rafId = null, lastLm = null;
    function heightVal() { var h = null; inputs().forEach(function (i) { if (i.dataset.k === 'height') h = parseFloat(i.value); }); return (h && h > 50 && h < 260) ? h : null; }
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
      if (!heightVal()) { msg('Enter your Height first — it calibrates the measurements.'); var hi = fieldsEl.querySelector('input[data-k="height"]'); if (hi) hi.focus(); return; }
      camOverlay.classList.remove('hidden'); camStatus.textContent = 'Starting…'; camMeasure.disabled = true; lastLm = null;
      try {
        await ensurePose();
        camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
        camVideo.srcObject = camStream; await camVideo.play();
        camStatus.textContent = 'Stand back — fit your whole body in frame.'; loop();
      } catch (e) { camStatus.textContent = 'Couldn’t start: ' + ((e && e.message) || 'camera/model unavailable') + '.'; }
    }
    var CONNECT = [[11,12],[11,23],[12,24],[23,24],[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[24,26],[26,28]];
    function loop() {
      if (!camStream) return;
      var vw = camVideo.videoWidth, vh = camVideo.videoHeight;
      if (vw && vh) {
        camCanvas.width = vw; camCanvas.height = vh;
        var res = null; try { res = poseLm.detectForVideo(camVideo, performance.now()); } catch (e) {}
        var ctx = camCanvas.getContext('2d'); ctx.clearRect(0, 0, vw, vh);
        if (res && res.landmarks && res.landmarks[0]) {
          lastLm = res.landmarks[0];
          ctx.strokeStyle = 'rgba(212,165,116,0.9)'; ctx.lineWidth = 3;
          CONNECT.forEach(function (c) { var a = lastLm[c[0]], b = lastLm[c[1]]; if (!a || !b) return; ctx.beginPath(); ctx.moveTo(a.x * vw, a.y * vh); ctx.lineTo(b.x * vw, b.y * vh); ctx.stroke(); });
          ctx.fillStyle = '#fff'; lastLm.forEach(function (p) { ctx.beginPath(); ctx.arc(p.x * vw, p.y * vh, 3, 0, 7); ctx.fill(); });
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
      var bodyPx = Math.abs(((lm[27].y + lm[28].y) / 2) * vh - lm[0].y * vh);
      if (bodyPx < 20) { msg('Move back so your whole body is visible.'); return; }
      var cmPerPx = hCm / (bodyPx / 0.88);
      var shW = dist(lm[11], lm[12], vw, vh) * cmPerPx, hipW = dist(lm[23], lm[24], vw, vh) * cmPerPx;
      var est = { shoulders: shW * 2.4, chest: shW * 2.2, waist: hipW * 2.3, hips: hipW * 2.7 };
      showEditor();
      inputs().forEach(function (i) { if (est[i.dataset.k] != null) i.value = Math.round(est[i.dataset.k]); });
      closeCam(); msg('Estimated from camera — adjust any number, then Save.');
    }
    function closeCam() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (camStream) { camStream.getTracks().forEach(function (t) { t.stop(); }); camStream = null; }
      if (camVideo) camVideo.srcObject = null; lastLm = null;
      if (camOverlay) camOverlay.classList.add('hidden');
    }
    scanBtn && scanBtn.addEventListener('click', openCam);
    camMeasure && camMeasure.addEventListener('click', measureFromPose);
    camClose && camClose.addEventListener('click', closeCam);

    document.addEventListener('veyra:navigate', function (e) { if (e.detail && e.detail.route === 'physique') load(); });
    load();
  });
})();
