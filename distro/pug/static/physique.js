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
    var dimGroup  = document.getElementById('physDimGroup');

    var FIELDS = [
      ['height','Height','cm'], ['weight','Weight','kg'], ['neck','Neck','cm'],
      ['shoulders','Shoulders','cm'], ['chest','Chest','cm'], ['waist','Waist','cm'],
      ['hips','Hips','cm'], ['arm','Arm','cm'], ['thigh','Thigh','cm'], ['calf','Calf','cm']
    ];
    var logs = [];          // [{id, date, m}]
    var mode3d = false;     // 2D by default
    var gender = localStorage.getItem('veyra_phys_gender') || 'female';  // which 3D body to load

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
    // swapDim() un-hides #physMannequin3d (it starts "hidden" in the raw HTML) — call it
    // here too, not just from the 2D/3D toggle, so the model is actually visible on a
    // fresh page load (previously it rendered into the container fine but the container
    // itself stayed hidden until you clicked the toggle at least once).
    function showFigure() { editorEl.classList.add('hidden'); figureEl.classList.remove('hidden'); swapDim(); renderFigure(); }

    // ── stats (left) ──
    function renderStats(m) {
      if (!m || !Object.keys(m).length) { statsEl.innerHTML = '<div class="phys-msg">No measurements yet.</div>'; return; }
      statsEl.innerHTML = FIELDS.filter(function (f) { return m[f[0]] != null; }).map(function (f) {
        return '<div class="phys-stat-row"><span>' + f[1] + '</span><span>' + m[f[0]] + ' ' + f[2] + '</span></div>';
      }).join('');
    }

    // ── 3D mannequin (Three.js + GLB, lazy-loaded) ──
    // Both "2D" and "3D" now show the SAME realistic model — "2D" is just a front view
    // held still (rotation frozen), "3D" lets it turn so you can see it from every side.
    // (The old flat SVG stick-figure is retired — it never looked like a real body.)
    // A real clothed body model (rebuilt in Blender from a CC-BY base mesh — see
    // distro/pug/blender/build_mannequin.py). The GLB carries one CALIBRATED morph target
    // per body zone (chest/waist/hips/thighs/calves/arms/shoulders), so each of the user's
    // tape measurements drives its own zone quantitatively (see morphInfluences below).
    var THREE = null, GLTFLoaderClass = null, three = {};   // three = {renderer, scene, camera, group, raf}
    var loadToken = 0;                                       // bumped to cancel stale async loads
    async function ensureThree() {
      if (!THREE) THREE = await import('three');             // resolved by the <importmap> in home.html
      return THREE;
    }
    async function ensureGLTF() {                            // the add-on imports bare 'three' (needs the map)
      if (!GLTFLoaderClass) GLTFLoaderClass = (await import('three/addons/loaders/GLTFLoader.js')).GLTFLoader;
      return GLTFLoaderClass;
    }
    function disposeThree() {
      loadToken++;                                           // any in-flight load is now stale
      if (three.raf) cancelAnimationFrame(three.raf);
      if (three.renderer) { three.renderer.dispose(); if (three.renderer.domElement && three.renderer.domElement.parentNode) three.renderer.domElement.parentNode.removeChild(three.renderer.domElement); }
      three = {};
    }
    function modelURL() {
      var base = window.VEYRA_MANNEQUIN_BASE || '/pug/static/models/';
      return base + 'mannequin_' + (gender === 'male' ? 'male' : 'female') + '.glb?v=5';  // ?v busts SW/browser cache
    }

    // The mannequins' OWN girths in cm (measured off the meshes during the Blender build —
    // the CALIB output of build_mannequin.py). Each morph target is calibrated so that
    // influence 1.0 == +20% girth in its zone (shoulders: +10% of shoulder circumference).
    // So:  influence = (user_cm / mannequin_cm - 1) / 0.20   — real tape-measure maths.
    var MORPH_REF = {
      male:   { height: 177, shoulders: 124.1,
                girth: { chest: 96.8, waist: 80.3, hips: 93.9, thigh: 51.7, calf: 38.7, arm: 29.2 } },
      female: { height: 165, shoulders: 100.0,
                girth: { chest: 85.7, waist: 75.7, hips: 94.9, thigh: 48.7, calf: 33.7, arm: 22.7 } }
    };
    var MORPH_KEY = { chest: 'chest', waist: 'waist', hips: 'hips',      // measurement field ->
                      thigh: 'thighs', calf: 'calves', arm: 'arms' };    // morph target in the GLB
    function clampInfl(v) { return Math.max(-1.2, Math.min(2, v)); }     // keep shapes plausible

    // Measurements -> per-zone morph influences. Zones without a measurement stay at the
    // mannequin's base shape (influence 0).
    function morphInfluences(m) {
      var ref = MORPH_REF[gender === 'male' ? 'male' : 'female'];
      var infl = {};
      if (!m) return infl;
      for (var f in MORPH_KEY) {
        if (m[f]) infl[MORPH_KEY[f]] = clampInfl((m[f] / ref.girth[f] - 1) / 0.20);
      }
      if (m.shoulders) infl.shoulders = clampInfl((m.shoulders / ref.shoulders - 1) / 0.10);
      return infl;
    }

    // Drive the model's shape keys + height scale from measurements. Cheap: just sets
    // influences, so it can run live on every measurement change (no reload). The clothing
    // primitives carry the same shape keys, so the underwear stretches with the body.
    function applyMorphs(m) {
      if (!three.morphMeshes) return;
      var infl = morphInfluences(m);
      three.morphMeshes.forEach(function (mesh) {
        var d = mesh.morphTargetDictionary, mi = mesh.morphTargetInfluences;
        if (!d || !mi) return;
        for (var k in d) mi[d[k]] = infl[k] || 0;
      });
      if (three.group) {                                          // taller user → taller mannequin
        var refH = MORPH_REF[gender === 'male' ? 'male' : 'female'].height;
        var s = (m && m.height) ? Math.max(0.85, Math.min(1.18, m.height / refH)) : 1;
        three.group.scale.set(1, s, 1);
      }
    }
    async function render3D() {
      var T;
      try { T = await ensureThree(); } catch (e) { msg('3D unavailable — staying in 2D.'); mode3d = false; syncDimBtns(); swapDim(); return; }
      disposeThree();
      var myToken = loadToken;                               // this render's identity
      mannequin3d.innerHTML = '<div class="phys3d-loading">Loading 3D…</div>';
      var w = mannequin3d.clientWidth || 280, h = mannequin3d.clientHeight || 420;
      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(35, w / h, 0.01, 100);
      var renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(w, h); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      scene.add(new T.AmbientLight(0xffffff, 0.75));
      var key = new T.DirectionalLight(0xffffff, 1.5); key.position.set(2, 3, 4); scene.add(key);
      var rim = new T.DirectionalLight(0xffffff, 0.6); rim.position.set(-2, 2, -3); scene.add(rim);
      var Loader;
      try { Loader = await ensureGLTF(); } catch (e) { if (myToken === loadToken) mannequin3d.innerHTML = '<div class="phys3d-loading">3D unavailable.</div>'; return; }
      if (myToken !== loadToken) return;                     // tab switched / gender changed while importing
      new Loader().load(modelURL(), function (gltf) {
        if (myToken !== loadToken) return;                   // superseded before the model finished downloading
        var model = gltf.scene;
        var box = new T.Box3().setFromObject(model);
        var size = new T.Vector3(); box.getSize(size);
        var center = new T.Vector3(); box.getCenter(center);
        model.position.sub(center);                          // re-center the body at the origin
        var grp = new T.Group(); grp.add(model); scene.add(grp);
        // collect every sub-mesh that has morph targets (body + each clothing primitive)
        var morphMeshes = [];
        model.traverse(function (o) { if (o.isMesh && o.morphTargetInfluences && o.morphTargetInfluences.length) morphMeshes.push(o); });
        var maxd = Math.max(size.x, size.y, size.z) || 1;
        camera.position.set(0, 0, maxd * 1.7); camera.lookAt(0, 0, 0);
        mannequin3d.innerHTML = ''; mannequin3d.appendChild(renderer.domElement);
        three = { renderer: renderer, scene: scene, camera: camera, group: grp, morphMeshes: morphMeshes, gender: gender };
        applyMorphs(latest() ? latest().m : null);           // shape the body to the user's numbers
        // "2D" = this same model, held front-on and still. "3D" = free to turn. Only spin
        // while in 3D mode; 2D stays pinned at rotation 0 (a clean, static front view).
        (function anim() {
          three.raf = requestAnimationFrame(anim);
          if (mode3d) grp.rotation.y += 0.01; else grp.rotation.y = 0;
          renderer.render(scene, camera);
        })();
      }, undefined, function () {
        if (myToken === loadToken) mannequin3d.innerHTML = '<div class="phys3d-loading">3D model failed to load.</div>';
      });
    }

    function swapDim() {
      // Both modes render the same model in #physMannequin3d — the retired flat SVG
      // container (#physMannequin) stays hidden regardless of mode.
      mannequin.classList.add('hidden');
      mannequin3d.classList.remove('hidden');
      if (three.group) three.group.rotation.y = 0;   // snap to front immediately on toggle
    }

    // ── figure render (both modes render the same 3D model — see swapDim) ──
    function renderFigure() {
      var cur = latest();
      cap.textContent = cur ? ('Updated ' + fmtDate(cur.date)) : '';
      // model already loaded for this gender → just re-shape it (cheap); else load it
      if (three.morphMeshes && three.gender === gender) applyMorphs(cur ? cur.m : null);
      else render3D();
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
    var clearBtn = document.getElementById('physClearBtn');
    clearBtn && clearBtn.addEventListener('click', function () {
      if (!logs.length) { msg('Nothing to clear.'); return; }
      if (!confirm('This will permanently delete ALL your measurements. Continue?')) return;
      fetch('/pug/api/physique/clear', { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function (res) { if (res && res.ok) { logs = []; fillInputs({}); showEditor(); refreshView(); msg('All measurements cleared.'); } else msg('Clear failed.'); })
        .catch(function () { msg('Clear failed.'); });
    });
    updateBtn && updateBtn.addEventListener('click', function () { var cur = latest(); fillInputs(cur ? cur.m : {}); showEditor(); });
    // 2D/3D toggle — same active/inactive pill pattern as the gender picker below, so
    // the highlighted button always shows which mode you're actually in.
    function syncDimBtns() {
      dimGroup && dimGroup.querySelectorAll('.phys-gbtn').forEach(function (b) {
        b.classList.toggle('gbtn-active', (b.getAttribute('data-dim') === '3d') === mode3d);
      });
    }
    if (dimGroup) {
      dimGroup.querySelectorAll('.phys-gbtn').forEach(function (b) {
        b.addEventListener('click', function () {
          var want3d = b.getAttribute('data-dim') === '3d';
          if (want3d === mode3d) return;                  // already in that mode
          mode3d = want3d;
          syncDimBtns(); swapDim();
          if (!figureEl.classList.contains('hidden')) renderFigure();
        });
      });
      syncDimBtns();
    }

    // Male/Female toggle for the 3D body (no profile gender field yet → manual pick, remembered).
    var genderWrap = document.getElementById('physGender');
    function syncGenderBtns() {
      genderWrap && genderWrap.querySelectorAll('.phys-gbtn').forEach(function (b) {
        b.classList.toggle('gbtn-active', b.getAttribute('data-g') === gender);
      });
    }
    if (genderWrap) {
      genderWrap.querySelectorAll('.phys-gbtn').forEach(function (b) {
        b.addEventListener('click', function () {
          gender = b.getAttribute('data-g') === 'male' ? 'male' : 'female';
          localStorage.setItem('veyra_phys_gender', gender);
          syncGenderBtns();
          if (mode3d && !figureEl.classList.contains('hidden')) render3D();  // reload the chosen body
        });
      });
      syncGenderBtns();
    }
    compareEl && compareEl.addEventListener('change', function () { var cur = latest(); var ghost = compareEl.value ? logById(compareEl.value) : null; renderDeltas(ghost ? ghost.m : null, cur ? cur.m : {}); if (!figureEl.classList.contains('hidden')) renderFigure(); });

    // ── Live camera measure (on-device MediaPipe pose; nothing stored) ──
    var camOverlay = document.getElementById('physCamOverlay'), camVideo = document.getElementById('physCamVideo'),
        camCanvas = document.getElementById('physCamCanvas'), camStatus = document.getElementById('physCamStatus'),
        camMeasure = document.getElementById('physCamMeasure'), camClose = document.getElementById('physCamClose'),
        camDevice = document.getElementById('physCamDevice');
    var photoBtn = document.getElementById('physPhotoBtn'), photoInput = document.getElementById('physPhotoInput');
    var poseLm = null, camStream = null, rafId = null, lastLm = null;
    var DEVICE_KEY = 'veyra_phys_camera_device_id';   // remembered across sessions — e.g. a phone used as a webcam
    async function refreshCamDevices() {              // populate the picker; only shown when there's a real choice
      if (!camDevice || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
      var list = [];
      try { list = (await navigator.mediaDevices.enumerateDevices()).filter(function (d) { return d.kind === 'videoinput'; }); } catch (e) { return; }
      if (list.length < 2) { camDevice.classList.add('hidden'); return; }
      var want = localStorage.getItem(DEVICE_KEY) || camDevice.value;
      camDevice.innerHTML = '';
      list.forEach(function (d, i) {
        var o = document.createElement('option');
        o.value = d.deviceId; o.textContent = d.label || ('Camera ' + (i + 1));
        camDevice.appendChild(o);
      });
      camDevice.value = list.some(function (d) { return d.deviceId === want; }) ? want : list[0].deviceId;
      camDevice.classList.remove('hidden');
    }
    if (navigator.mediaDevices) navigator.mediaDevices.ondevicechange = refreshCamDevices;
    camDevice && camDevice.addEventListener('change', function () {
      localStorage.setItem(DEVICE_KEY, camDevice.value);
      if (camStream) { camStream.getTracks().forEach(function (t) { t.stop(); }); camStream = null; openCam(); }
    });
    var poseMode = 'VIDEO';                           // the one landmarker serves both live scan and photos
    // Auto-capture: you can't reach the button from 2m away, so once the WHOLE body is
    // in frame we count down on-screen and measure automatically (median of the frames).
    var AUTO_MS = 3000, GRACE_MS = 2000;             // countdown length; allowed detection dropout
                                                       // (bumped from 700 — a relayed/bridged camera feed,
                                                       // e.g. phone-over-USB, stutters more than a native
                                                       // webcam and was resetting the countdown constantly)
    var autoStart = 0, lastGood = 0, samples = [];
    var pendingEst = null;                           // single estimate from a photo (no countdown)
    var showDone = false;                            // true while the "✓ done" frame is being held on screen
    var audioCtx = null;
    function beep() {                                 // audible "captured" cue — you're far from the screen
      try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = 880; g.gain.value = 0.08;
        o.connect(g); g.connect(audioCtx.destination);
        o.start(); o.stop(audioCtx.currentTime + 0.18);
      } catch (e) {}
    }
    function beepOk() {                               // distinct two-tone "all done" cue, separate from the capture beep
      try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        [660, 990].forEach(function (freq, i) {
          var o = audioCtx.createOscillator(), g = audioCtx.createGain();
          o.frequency.value = freq; g.gain.value = 0.08;
          o.connect(g); g.connect(audioCtx.destination);
          var t = audioCtx.currentTime + i * 0.14;
          o.start(t); o.stop(t + 0.16);
        });
      } catch (e) {}
    }
    function speakDone() {                            // spoken "done" — you don't need to see the screen at all
      try {
        if (!window.speechSynthesis) return;
        window.speechSynthesis.cancel();               // don't queue up behind a stale utterance
        var u = new SpeechSynthesisUtterance('Done measuring');
        u.rate = 1; u.volume = 1;
        setTimeout(function () { window.speechSynthesis.speak(u); }, 300);  // let the beep finish first
      } catch (e) {}
    }
    function fullBody(lm, vh) {                       // nose + shoulders + hips + ankles all visible, in frame, big enough
      var need = [0, 11, 12, 23, 24, 27, 28];
      for (var i = 0; i < need.length; i++) {
        var p = lm[need[i]];
        if (!p || (p.visibility != null && p.visibility < 0.5) || p.y < -0.02 || p.y > 1.02) return false;
      }
      return Math.abs(((lm[27].y + lm[28].y) / 2) - lm[0].y) * vh > vh * 0.45;
    }
    function drawCount(ctx, vw, vh, n) {              // big enough to read from across the room
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.arc(vw / 2, vh / 2, 70, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 96px system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(n), vw / 2, vh / 2 + 6);
    }
    function drawDone(ctx, vw, vh) {                  // big green ✓ — the unmistakable "you're done" signal
      ctx.clearRect(0, 0, vw, vh);
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, 0, vw, vh);
      ctx.fillStyle = 'rgba(46,207,114,0.95)';
      ctx.beginPath(); ctx.arc(vw / 2, vh / 2, 90, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(vw / 2 - 42, vh / 2 + 2); ctx.lineTo(vw / 2 - 12, vh / 2 + 32); ctx.lineTo(vw / 2 + 46, vh / 2 - 34);
      ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 34px system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Done!', vw / 2, vh / 2 + 130);
    }
    function heightVal() { var h = null; inputs().forEach(function (i) { if (i.dataset.k === 'height') h = parseFloat(i.value); }); return (h && h > 50 && h < 260) ? h : null; }
    async function ensurePose() {
      if (poseLm) return poseLm;
      camStatus.textContent = 'Loading model…';
      var V = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12';
      var vision = await import(V);
      var fileset = await vision.FilesetResolver.forVisionTasks(V + '/wasm');
      poseLm = await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' },
        runningMode: 'VIDEO', numPoses: 1,
        outputSegmentationMasks: true   // body silhouette → measure real widths (arm/thigh/calf too)
      });
      poseMode = 'VIDEO';
      return poseLm;
    }
    async function setPoseMode(mode) {               // both live scan and photos stay in 'VIDEO' mode now
      await ensurePose();
      if (poseMode !== mode) { await poseLm.setOptions({ runningMode: mode }); poseMode = mode; }
    }
    function drawSkeleton(ctx, lm, vw, vh) {
      ctx.strokeStyle = 'rgba(212,165,116,0.9)'; ctx.lineWidth = 3;
      CONNECT.forEach(function (c) { var a = lm[c[0]], b = lm[c[1]]; if (!a || !b) return; ctx.beginPath(); ctx.moveTo(a.x * vw, a.y * vh); ctx.lineTo(b.x * vw, b.y * vh); ctx.stroke(); });
      ctx.fillStyle = '#fff'; lm.forEach(function (p) { ctx.beginPath(); ctx.arc(p.x * vw, p.y * vh, 3, 0, 7); ctx.fill(); });
    }
    async function openCam() {
      if (!camOverlay) return;
      if (!heightVal()) { msg('Enter your Height first — it calibrates the measurements.'); var hi = fieldsEl.querySelector('input[data-k="height"]'); if (hi) hi.focus(); return; }
      camOverlay.classList.remove('hidden'); camStatus.textContent = 'Starting…'; camMeasure.disabled = true; lastLm = null;
      autoStart = 0; lastGood = 0; samples = []; pendingEst = null; camVideo.style.display = '';
      try {
        await setPoseMode('VIDEO');
        await refreshCamDevices();                     // labels are blank pre-permission on first-ever run, that's fine
        var chosen = camDevice && !camDevice.classList.contains('hidden') ? camDevice.value : '';
        var videoConstraints = chosen ? { deviceId: { exact: chosen }, width: 640, height: 480 } : { facingMode: 'user', width: 640, height: 480 };
        camStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
        camVideo.srcObject = camStream; await camVideo.play();
        refreshCamDevices();                           // re-run now that permission is granted → real device labels
        camStatus.textContent = 'Stand back, arms angled OUT from your body (elbows away from your ribs), feet apart — once your whole body fits it measures itself.'; loop();
      } catch (e) { camStatus.textContent = 'Couldn’t start: ' + ((e && e.message) || 'camera/model unavailable') + '.'; }
    }
    var CONNECT = [[11,12],[11,23],[12,24],[23,24],[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[24,26],[26,28]];
    function loop() {
      if (!camStream || showDone) return;               // hold the "✓ Done" frame on screen, don't paint over it
      var vw = camVideo.videoWidth, vh = camVideo.videoHeight;
      if (vw && vh) {
        camCanvas.width = vw; camCanvas.height = vh;
        var res = null; try { res = poseLm.detectForVideo(camVideo, performance.now()); } catch (e) {}
        var ctx = camCanvas.getContext('2d'); ctx.clearRect(0, 0, vw, vh);
        if (res && res.landmarks && res.landmarks[0]) {
          lastLm = res.landmarks[0];
          drawSkeleton(ctx, lastLm, vw, vh);
          camMeasure.disabled = false;
          var now = performance.now();
          if (fullBody(lastLm, vh)) {
            lastGood = now;
            if (!autoStart) { autoStart = now; samples = []; }
            var mask = readMask(res);                 // reads + frees the mask
            var est = (mask && segEst(lastLm, mask.arr, mask.w, mask.h)) || frameEst(lastLm, vw, vh);
            if (est) samples.push(est);
            if (now - autoStart >= AUTO_MS) {
              beep(); measureFromPose();
              if (camStream) rafId = requestAnimationFrame(loop);
              return;
            }
            var left = Math.ceil((AUTO_MS - (now - autoStart)) / 1000);
            drawCount(ctx, vw, vh, left);
            camStatus.textContent = 'Hold still — measuring in ' + left + '…';
          } else {
            closeMask(res);                           // not counting down → don't leak the mask
            if (autoStart && now - lastGood > GRACE_MS) { autoStart = 0; samples = []; }
            camStatus.textContent = 'Fit your WHOLE body in frame — arms angled OUT, feet apart — it measures itself.';
          }
        } else {
          closeMask(res);
          camMeasure.disabled = true;
          if (autoStart && performance.now() - lastGood > GRACE_MS) { autoStart = 0; samples = []; }
        }
      }
      rafId = requestAnimationFrame(loop);
    }
    function dist(a, b, vw, vh) { var dx = (a.x - b.x) * vw, dy = (a.y - b.y) * vh; return Math.sqrt(dx * dx + dy * dy); }
    function frameEst(lm, vw, vh) {                   // one frame -> cm estimates (nose→ankle pixels calibrate the scale)
      var hCm = heightVal();
      if (!lm || !hCm) return null;
      var bodyPx = Math.abs(((lm[27].y + lm[28].y) / 2) - lm[0].y) * vh;
      if (bodyPx < 20) return null;
      var cmPerPx = hCm / (bodyPx / 0.88);            // nose→ankle ≈ 88% of standing height
      var shW = dist(lm[11], lm[12], vw, vh) * cmPerPx, hipW = dist(lm[23], lm[24], vw, vh) * cmPerPx;
      // Factors map JOINT-to-JOINT distances (much narrower than the silhouette — hip
      // joints are ~18cm apart on a ~35cm-wide body) to girths. Calibrated against the
      // FIRST tape test only (chest 83/waist 78/hips 89) — this is the FALLBACK used only
      // when the segmentation mask isn't available (see segEst above, the primary path,
      // which has since been retuned against a fuller tape set — this one hasn't, because
      // no fresh test has exercised this fallback path since). Known stale; revisit if
      // this path turns out to be firing in practice.
      return { shoulders: shW * 2.9, chest: shW * 2.6, waist: hipW * 4.4, hips: hipW * 5.0 };
    }

    // ── Segmentation measure: read the body SILHOUETTE and measure real outline widths
    //    at each landmark height, then convert width → girth. Joint distances can't give
    //    limb thickness; the silhouette can, so this fills arm/thigh/calf/neck too. ──
    // width(cm) → circumference(cm). Torso is elliptical (~3×), limbs ~round (~π). These
    // are the CALIBRATION knobs — tune against a tape measure. (2026-07: pre-calibration.)
    // Retuned 2026-07 from real tape tests. waist/hips/thigh/calf now land within ~5% of
    // tape — trust these. chest/arm are STILL WRONG (not a calibration issue): at
    // armpit height the arm sits directly against the torso with no real gap even when
    // held "a little out", so the silhouette sweep can't separate them — needs a wider
    // arm angle in the pose (~30-40°), not a bigger/smaller factor. Left un-retuned
    // until a clean (wide-arm) re-test comes in.
    // ⚠️ SINGLE-SUBJECT CALIBRATION: every number below is fit to ONE body (168cm/53kg).
    // The width→circumference ratio genuinely varies with body composition (rounder vs.
    // flatter cross-section), so accuracy for very different builds is unverified — this
    // is a starting baseline, not a validated population model. Re-tune with tape data
    // from a few different body types before trusting this cross-population.
    var FAC = { neck: 3.3, shoulders: 2.45, chest: 3.05, waist: 2.34, hips: 2.51,
                arm: 3.05, thigh: 2.89, calf: 2.96 };
    function readMask(res) {                          // float32 person-mask (0..1 per px) + dims; frees the GPU mask
      if (!res || !res.segmentationMasks || !res.segmentationMasks[0]) return null;
      var m = res.segmentationMasks[0], out = null;
      try { out = { arr: m.getAsFloat32Array(), w: m.width, h: m.height }; } catch (e) {}
      try { m.close(); } catch (e) {}
      return out;
    }
    function closeMask(res) { if (res && res.segmentationMasks && res.segmentationMasks[0]) { try { res.segmentationMasks[0].close(); } catch (e) {} } }
    function isBody(mask, mW, mH, x, y) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || x >= mW || y < 0 || y >= mH) return false;
      return mask[y * mW + x] > 0.5;
    }
    // width (px) of the body run containing (cxN,yN), horizontally. loL/hiL (px, optional)
    // cap how far the sweep may travel in each direction — without this, a torso sweep
    // can bridge a small gap to an arm held slightly out and report shoulder-to-shoulder
    // (or hand-to-hand) width instead of chest width. We cap at the elbow position, since
    // a real torso edge always sits between center and the elbow.
    function runWidthPx(mask, mW, mH, cxN, yN, loL, hiL) {
      var y = Math.round(yN * mH), cx = Math.round(cxN * mW);
      loL = (loL == null) ? -Infinity : loL; hiL = (hiL == null) ? Infinity : hiL;
      if (!isBody(mask, mW, mH, cx, y)) {             // landmark may sit just off the silhouette → snap onto it
        var found = -1, lim = Math.round(mW * 0.15);
        for (var d = 1; d < lim; d++) {
          if (cx - d >= loL && isBody(mask, mW, mH, cx - d, y)) { found = cx - d; break; }
          if (cx + d <= hiL && isBody(mask, mW, mH, cx + d, y)) { found = cx + d; break; }
        }
        if (found < 0) return 0; cx = found;
      }
      var l = cx, r = cx;
      while (l - 1 >= loL && isBody(mask, mW, mH, l - 1, y)) l--;
      while (r + 1 <= hiL && isBody(mask, mW, mH, r + 1, y)) r++;
      return r - l + 1;
    }
    // Limb thickness measured PERPENDICULAR to the bone's own direction (shoulder→elbow,
    // hip→knee, knee→ankle), not a horizontal slice — a horizontal slice overstates a
    // slanted limb (the same fix already used for the 3D mannequin's arm calibration).
    // Also avoids snapping onto the torso when the limb sits close to it.
    function limbWidthPx(mask, mW, mH, aXn, aYn, bXn, bYn) {
      var midXn = (aXn + bXn) / 2, midYn = (aYn + bYn) / 2;
      var dx = (bXn - aXn) * mW, dy = (bYn - aYn) * mH;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) return 0;
      var pX = -dy / len, pY = dx / len;              // unit vector perpendicular to the bone
      var cx = midXn * mW, cy = midYn * mH;
      if (!isBody(mask, mW, mH, cx, cy)) {             // tight snap only — don't risk jumping to the torso
        var found = false, tight = 8;
        for (var d = 1; d <= tight && !found; d++) {
          if (isBody(mask, mW, mH, cx + pX * d, cy + pY * d)) { cx += pX * d; cy += pY * d; found = true; }
          else if (isBody(mask, mW, mH, cx - pX * d, cy - pY * d)) { cx -= pX * d; cy -= pY * d; found = true; }
        }
        if (!found) return 0;
      }
      var cap = Math.min(mW, mH) * 0.22;               // sane ceiling — a limb can't be torso-wide
      var a = 0, b = 0;
      while (a + 1 <= cap && isBody(mask, mW, mH, cx + pX * (a + 1), cy + pY * (a + 1))) a++;
      while (b + 1 <= cap && isBody(mask, mW, mH, cx - pX * (b + 1), cy - pY * (b + 1))) b++;
      return a + b + 1;
    }
    function segEst(lm, mask, mW, mH) {
      var hCm = heightVal();
      if (!lm || !hCm || !mask) return null;
      var bodyPx = Math.abs(((lm[27].y + lm[28].y) / 2) - lm[0].y) * mH;
      if (bodyPx < 20) return null;
      var cmPerPx = hCm / (bodyPx / 0.88);
      // Torso sweeps must stop at the elbow — a real torso edge always sits between
      // center and the elbow, so this is a hard boundary against bridging a small
      // arms-slightly-out gap and reporting shoulder-to-shoulder (or wider) by mistake.
      var elbowLx = Math.min(lm[13].x, lm[14].x) * mW, elbowRx = Math.max(lm[13].x, lm[14].x) * mW;
      function girth(cxN, yN, fac) {
        var w = runWidthPx(mask, mW, mH, cxN, yN, elbowLx, elbowRx) * cmPerPx;
        return (w > 0 && w < 120) ? w * fac : null;
      }
      function limbGirth(a, b, fac) {
        var w = limbWidthPx(mask, mW, mH, lm[a].x, lm[a].y, lm[b].x, lm[b].y) * cmPerPx;
        return (w > 0 && w < 90) ? w * fac : null;
      }
      var shX = (lm[11].x + lm[12].x) / 2, shY = (lm[11].y + lm[12].y) / 2;
      var hpX = (lm[23].x + lm[24].x) / 2, hpY = (lm[23].y + lm[24].y) / 2;
      var span = hpY - shY, mid = (shX + hpX) / 2, out = {}, v;
      if ((v = girth(shX, shY - (shY - lm[0].y) * 0.40, FAC.neck)))  out.neck = v;
      if ((v = girth(mid, shY,                        FAC.shoulders))) out.shoulders = v;
      if ((v = girth(mid, shY + span * 0.22,          FAC.chest)))   out.chest = v;
      if ((v = girth(mid, shY + span * 0.72,          FAC.waist)))   out.waist = v;
      if ((v = girth(hpX, hpY + span * 0.08,          FAC.hips)))    out.hips = v;
      if ((v = limbGirth(12, 14, FAC.arm)))   out.arm = v;    // shoulder → elbow
      if ((v = limbGirth(24, 26, FAC.thigh))) out.thigh = v;  // hip → knee
      if ((v = limbGirth(26, 28, FAC.calf)))  out.calf = v;   // knee → ankle
      return out;
    }
    function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.floor(s.length / 2)]; }
    function measureFromPose() {
      var est;
      if (samples.length >= 5) {                      // countdown ran: median each field over the frames
        est = {};
        var keys = {};
        samples.forEach(function (s) { for (var k in s) keys[k] = 1; });
        Object.keys(keys).forEach(function (k) {
          var vals = samples.map(function (s) { return s[k]; }).filter(function (x) { return x != null; });
          if (vals.length) est[k] = median(vals);
        });
      } else if (pendingEst) {                        // a photo was analyzed → use its estimate
        est = pendingEst;
      } else {                                        // manual Measure tap with no samples → current frame
        est = frameEst(lastLm, camCanvas.width, camCanvas.height);
      }
      autoStart = 0; samples = [];
      if (!est || !Object.keys(est).length) { msg('No full body detected — try again.'); return; }
      showEditor();
      inputs().forEach(function (i) { if (est[i.dataset.k] != null) i.value = Math.round(est[i.dataset.k]); });
      // Hold a big ✓ + "Done!" on screen for a beat before closing — a text status line
      // is easy to miss if you're standing away from the screen; this isn't.
      if (camCanvas && camCanvas.width) drawDone(camCanvas.getContext('2d'), camCanvas.width, camCanvas.height);
      showDone = true; camMeasure.disabled = true;
      camStatus.textContent = '✓ Done — measurements captured.';
      beepOk(); speakDone();
      setTimeout(function () { closeCam(); msg('Measured — adjust any number, then Save.'); }, 1400);
    }
    // Measure from an uploaded photo — for when the webcam can't frame your whole body
    // (laptop on a table). The file is read + analyzed HERE in the browser and discarded:
    // it is never uploaded to the server or saved anywhere.
    async function openPhoto(file) {
      if (!camOverlay || !file) return;
      if (!heightVal()) { msg('Enter your Height first — it calibrates the measurements.'); var hi = fieldsEl.querySelector('input[data-k="height"]'); if (hi) hi.focus(); return; }
      closeCam();                                     // in case the live scan was open
      camOverlay.classList.remove('hidden'); camMeasure.disabled = true;
      camVideo.style.display = 'none';                // canvas shows the photo instead
      camStatus.textContent = 'Analyzing photo…';
      var url = URL.createObjectURL(file);
      try {
        // Stay in VIDEO mode + detectForVideo() even for a still photo (one frame) — the
        // IMAGE-mode + segmentation-mask combo can hard-crash the MediaPipe WASM runtime
        // (native abort, not a catchable JS error) on some inputs. VIDEO mode is the same
        // path the live scan already uses successfully, so photos ride the proven route.
        await setPoseMode('VIDEO');
        var img = new Image();
        await new Promise(function (ok, bad) { img.onload = ok; img.onerror = bad; img.src = url; });
        var scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));  // phone photos are huge
        var vw = Math.round(img.naturalWidth * scale), vh = Math.round(img.naturalHeight * scale);
        camCanvas.width = vw; camCanvas.height = vh;
        var ctx = camCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0, vw, vh);
        var res = poseLm.detectForVideo(camCanvas, performance.now());
        if (res && res.landmarks && res.landmarks[0]) {
          lastLm = res.landmarks[0];
          drawSkeleton(ctx, lastLm, vw, vh);
          var mask = readMask(res);                    // silhouette from the photo
          pendingEst = (mask && segEst(lastLm, mask.arr, mask.w, mask.h)) || frameEst(lastLm, vw, vh);
          camMeasure.disabled = !(pendingEst && Object.keys(pendingEst).length);
          camStatus.textContent = fullBody(lastLm, vh)
            ? 'Body found — tap Measure.'
            : 'Found a body, but maybe not all of it — Measure anyway, or try a photo showing head to feet.';
        } else {
          closeMask(res);
          camStatus.textContent = 'No body found in that photo — try one with your whole body, front-on.';
        }
      } catch (e) {
        camStatus.textContent = 'Couldn’t read that photo — try a different one.';
      } finally { URL.revokeObjectURL(url); }
    }
    function closeCam() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (camStream) { camStream.getTracks().forEach(function (t) { t.stop(); }); camStream = null; }
      if (camVideo) { camVideo.srcObject = null; camVideo.style.display = ''; } lastLm = null;
      autoStart = 0; lastGood = 0; samples = []; pendingEst = null; showDone = false;
      // wipe any uploaded photo off the canvas — nothing lingers behind the hidden overlay
      if (camCanvas && camCanvas.width) camCanvas.getContext('2d').clearRect(0, 0, camCanvas.width, camCanvas.height);
      if (camOverlay) camOverlay.classList.add('hidden');
    }
    scanBtn && scanBtn.addEventListener('click', openCam);
    photoBtn && photoBtn.addEventListener('click', function () { photoInput && photoInput.click(); });
    photoInput && photoInput.addEventListener('change', function () {
      openPhoto(photoInput.files && photoInput.files[0]);
      photoInput.value = '';                          // so re-picking the same file re-fires change
    });
    camMeasure && camMeasure.addEventListener('click', measureFromPose);
    camClose && camClose.addEventListener('click', closeCam);

    // "How to measure" guide — plain reference, no camera/state involved.
    var howBtn = document.getElementById('physHowBtn'), howOverlay = document.getElementById('physHowOverlay'),
        howClose = document.getElementById('physHowClose');
    howBtn && howBtn.addEventListener('click', function () { howOverlay && howOverlay.classList.remove('hidden'); });
    howClose && howClose.addEventListener('click', function () { howOverlay && howOverlay.classList.add('hidden'); });

    document.addEventListener('veyra:navigate', function (e) { if (e.detail && e.detail.route === 'physique') load(); });
    load();
  });
})();
