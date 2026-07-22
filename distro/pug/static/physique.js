/**
 * physique.js — Physique tab. Log body measurements over time → a digital mannequin
 * (2D SVG, or 3D via Three.js) built from the numbers; compare against an earlier date.
 * Measurements are entered manually (tape). The camera is used for a separate on-device
 * MediaPipe POSTURE CHECK (shoulder/neck tilt, knee alignment, forward-head/hunch) —
 * this replaced an earlier camera measurement-scan feature that hit an unfixable
 * silhouette-segmentation ceiling on chest/neck/arm (2026-07-21). Posture reads joint
 * ANGLES, not silhouette widths, so it doesn't hit that same failure mode.
 * NO photos are ever stored — frames are processed live and discarded; only the
 * computed numbers persist. Backend: /pug/api/physique (GET/POST/DELETE).
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
    var postureStatsEl = document.getElementById('physPostureStats');
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
    var KNEE_LABEL = { normal: 'Normal', knock_kneed: 'Knock-kneed (knees in)', bow_legged: 'Bow-legged (knees out)', unknown: 'Not detected clearly' };
    var HUNCH_LABEL = { normal: 'Normal', mild_forward_head: 'Mild forward head / rounded shoulders', noticeable_forward_head: 'Noticeable forward head / rounded shoulders', unknown: 'Not detected clearly' };
    function findLatestPosture() {                     // most recent log that actually has a posture reading
      for (var i = logs.length - 1; i >= 0; i--) if (logs[i].m && logs[i].m.posture) return logs[i];
      return null;
    }
    function renderPosture() {
      var l = findLatestPosture();
      if (!postureStatsEl) return;
      if (!l) { postureStatsEl.innerHTML = ''; return; }
      var p = l.m.posture;
      var rows = [];
      if (p.shoulderTiltDeg != null) rows.push('<div class="phys-stat-row"><span>Shoulder tilt</span><span>' + Math.abs(p.shoulderTiltDeg) + '°</span></div>');
      if (p.earTiltDeg != null) rows.push('<div class="phys-stat-row"><span>Neck tilt</span><span>' + Math.abs(p.earTiltDeg) + '°</span></div>');
      if (p.kneeFlag) rows.push('<div class="phys-stat-row"><span>Knees</span><span>' + (KNEE_LABEL[p.kneeFlag] || p.kneeFlag) + '</span></div>');
      if (p.hunchFlag) rows.push('<div class="phys-stat-row"><span>Posture (side view)</span><span>' + (HUNCH_LABEL[p.hunchFlag] || p.hunchFlag) + (p.hunchAngleDeg != null ? ' · ' + p.hunchAngleDeg + '°' : '') + '</span></div>');
      postureStatsEl.innerHTML = '<div class="phys-section-label" style="margin-top:18px;">Posture check <span style="opacity:.55;font-weight:400;">— ' + fmtDate(l.date) + '</span></div>' +
        rows.join('') +
        '<div class="phys-how-lead" style="margin-top:6px;">Not a medical diagnosis — a rough on-device estimate. See a professional about anything persistent.</div>';
    }
    function renderStats(m) {
      if (!m || !Object.keys(m).length) { statsEl.innerHTML = '<div class="phys-msg">No measurements yet.</div>'; }
      else {
        statsEl.innerHTML = FIELDS.filter(function (f) { return m[f[0]] != null; }).map(function (f) {
          return '<div class="phys-stat-row"><span>' + f[1] + '</span><span>' + m[f[0]] + ' ' + f[2] + '</span></div>';
        }).join('');
      }
      renderPosture();
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

    // ── Posture check (on-device MediaPipe pose; nothing stored) — TWO steps: a front-on
    // shot (shoulder tilt, neck tilt, knee alignment) then a side-profile shot (forward-
    // head / rounded-shoulders "hunch"). This REPLACED the earlier camera measurement-scan
    // (see file header) — posture reads joint ANGLES off the landmarks directly, not
    // silhouette widths, so it doesn't hit the segmentation ceiling that made chest/neck/
    // arm unfixable there, and doesn't need a height calibration first.
    // Left/right anatomical labeling is intentionally NOT shown for tilt — the video feed
    // isn't mirrored, so which landmark maps to image-left vs the subject's-own-left is
    // unverified; showing a wrong side would be worse than showing a magnitude only.
    var camOverlay = document.getElementById('physCamOverlay'), camVideo = document.getElementById('physCamVideo'),
        camCanvas = document.getElementById('physCamCanvas'), camStatus = document.getElementById('physCamStatus'),
        camMeasure = document.getElementById('physCamMeasure'), camClose = document.getElementById('physCamClose'),
        camDevice = document.getElementById('physCamDevice'), camMic = document.getElementById('physCamMic'),
        camRetake = document.getElementById('physCamRetake'), camConfirm = document.getElementById('physCamConfirm');
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
    var poseMode = 'VIDEO';
    // Auto-capture: you can't reach the button from 2m away, so once the current step's
    // pose gate passes we count down on-screen and capture automatically (median of frames).
    var AUTO_MS = 3000, GRACE_MS = 2000;
    var autoStart = 0, lastGood = 0, samples = [];
    var pendingPosture = null;                        // this step's reading, awaiting Retake/Confirm
    var postureStep = null;                           // 'front' | 'side' | null (modal closed)
    var postureData = {};                             // { front:{...}, side:{...} } accumulated across the 2 steps
    var captureSource = 'live';                        // 'live' | 'photo' — which path drove the current step
    var showDone = false;
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
    function beepOk() {                               // distinct two-tone "captured" cue
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
    function speakDone(text) {                        // spoken cue — you don't need to see the screen at all
      try {
        if (!window.speechSynthesis) return;
        window.speechSynthesis.cancel();               // don't queue up behind a stale utterance
        var u = new SpeechSynthesisUtterance(text || 'Captured');
        u.rate = 1; u.volume = 1;
        setTimeout(function () { window.speechSynthesis.speak(u); }, 300);  // let the beep finish first
      } catch (e) {}
    }
    function fullBody(lm, vh) {                       // front-view gate: nose+shoulders+hips+ankles visible, in frame, big enough
      var need = [0, 11, 12, 23, 24, 27, 28];
      for (var i = 0; i < need.length; i++) {
        var p = lm[need[i]];
        if (!p || (p.visibility != null && p.visibility < 0.5) || p.y < -0.02 || p.y > 1.02) return false;
      }
      return Math.abs(((lm[27].y + lm[28].y) / 2) - lm[0].y) * vh > vh * 0.45;
    }
    // Side-view gate: a true profile shot self-occludes the far side, so this only
    // requires ONE side's ear/shoulder/hip/ankle (whichever ear reads more visible).
    function sideOk(lm, vh) {
      var side = (lm[7] && lm[7].visibility != null ? lm[7].visibility : 1) >=
                 (lm[8] && lm[8].visibility != null ? lm[8].visibility : 1) ? 'left' : 'right';
      var need = side === 'left' ? [7, 11, 23, 27] : [8, 12, 24, 28];
      for (var i = 0; i < need.length; i++) {
        var p = lm[need[i]];
        if (!p || (p.visibility != null && p.visibility < 0.5) || p.y < -0.02 || p.y > 1.02) return false;
      }
      var earIdx = side === 'left' ? 7 : 8, ankIdx = side === 'left' ? 27 : 28;
      return Math.abs(lm[ankIdx].y - lm[earIdx].y) * vh > vh * 0.45;
    }
    function drawCount(ctx, vw, vh, n) {              // big enough to read from across the room
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.arc(vw / 2, vh / 2, 70, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 96px system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(n), vw / 2, vh / 2 + 6);
    }
    function drawDone(ctx, vw, vh) {                  // small green ✓ badge in the corner — deliberately does NOT
      var r = Math.max(18, Math.min(34, vw * 0.06)), cx = vw - r - 14, cy = r + 14;   // cover the frame, so the
      ctx.fillStyle = 'rgba(46,207,114,0.95)';                                          // captured shot underneath
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();                            // stays reviewable
      ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(3, r * 0.16); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.45, cy + r * 0.02); ctx.lineTo(cx - r * 0.1, cy + r * 0.38); ctx.lineTo(cx + r * 0.5, cy - r * 0.4);
      ctx.stroke();
    }
    function round1(v) { return Math.round(v * 10) / 10; }
    function round2(v) { return Math.round(v * 100) / 100; }
    function angleDeg(dx, dy) { return Math.atan2(dy, dx) * 180 / Math.PI; }
    // Heuristic first-pass thresholds — this is a brand-new feature with no tape/photo
    // ground truth yet (unlike the measurement scan's FAC table, which was retuned against
    // real tape tests). Revisit once real posture reads come back against how a person
    // actually looks, the same way the old scan's calibration was tuned from real data.
    function classifyKnee(ratio) {
      if (ratio == null) return 'unknown';
      if (ratio < 0.5) return 'knock_kneed';
      if (ratio > 1.8) return 'bow_legged';
      return 'normal';
    }
    function classifyHunch(angle) {
      if (angle == null) return 'unknown';
      if (angle >= 70) return 'normal';
      if (angle >= 55) return 'mild_forward_head';
      return 'noticeable_forward_head';
    }
    // Front view: feet together, facing the camera. Shoulder/ear tilt = angle of the L-R
    // line off horizontal (magnitude only, see the note above on left/right labeling).
    // Knee alignment: with feet together, compare the knee-to-knee gap to the ankle-to-
    // ankle gap — much closer knees than ankles reads as knock-kneed, much wider as bow-legged.
    function frontPosture(lm) {
      var shoulderTiltDeg = null, earTiltDeg = null, kneeRatio = null;
      if (lm[11] && lm[12]) shoulderTiltDeg = angleDeg(lm[12].x - lm[11].x, lm[12].y - lm[11].y);
      if (lm[7] && lm[8] && (lm[7].visibility == null || lm[7].visibility > 0.4) && (lm[8].visibility == null || lm[8].visibility > 0.4)) {
        earTiltDeg = angleDeg(lm[8].x - lm[7].x, lm[8].y - lm[7].y);
      }
      if (lm[25] && lm[26] && lm[27] && lm[28] &&
          (lm[25].visibility == null || lm[25].visibility > 0.5) && (lm[26].visibility == null || lm[26].visibility > 0.5)) {
        var kneeGap = Math.abs(lm[26].x - lm[25].x), ankleGap = Math.abs(lm[28].x - lm[27].x);
        if (ankleGap > 0.01) kneeRatio = kneeGap / ankleGap;
      }
      return { shoulderTiltDeg: shoulderTiltDeg, earTiltDeg: earTiltDeg, kneeRatio: kneeRatio };
    }
    // Side view: the "plumb line" proxy used by most photo-based posture checks — angle
    // of the shoulder→ear line off horizontal. Near-vertical (~90°) = head stacked over
    // the shoulder (good); the more the line lies toward horizontal, the further the head
    // juts forward (forward-head / rounded-shoulders, the visible sign of a hunch).
    function sidePosture(lm) {
      var side = (lm[7] && lm[7].visibility != null ? lm[7].visibility : 1) >=
                 (lm[8] && lm[8].visibility != null ? lm[8].visibility : 1) ? 'left' : 'right';
      var ear = lm[side === 'left' ? 7 : 8], sh = lm[side === 'left' ? 11 : 12];
      if (!ear || !sh) return null;
      var dx = Math.abs(ear.x - sh.x), dy = sh.y - ear.y;   // dy > 0: ear sits above the shoulder, as expected
      return { hunchAngleDeg: Math.max(0, Math.min(90, angleDeg(dy, dx))), side: side };
    }
    function mode(arr) {
      var counts = {}, best = null, bestN = 0;
      arr.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; if (counts[v] > bestN) { bestN = counts[v]; best = v; } });
      return best;
    }
    function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.floor(s.length / 2)]; }
    function medianField(list, key) {
      var vals = list.map(function (s) { return s[key]; }).filter(function (v) { return v != null && !isNaN(v); });
      return vals.length ? median(vals) : null;
    }
    function combineFront(list) {
      var shoulderTiltDeg = medianField(list, 'shoulderTiltDeg'), earTiltDeg = medianField(list, 'earTiltDeg'), kneeRatio = medianField(list, 'kneeRatio');
      return {
        shoulderTiltDeg: shoulderTiltDeg != null ? round1(shoulderTiltDeg) : null,
        earTiltDeg: earTiltDeg != null ? round1(earTiltDeg) : null,
        kneeRatio: kneeRatio != null ? round2(kneeRatio) : null,
        kneeFlag: classifyKnee(kneeRatio)
      };
    }
    function combineSide(list) {
      var hunchAngleDeg = medianField(list, 'hunchAngleDeg');
      var sides = list.map(function (s) { return s.side; }).filter(Boolean);
      return { hunchAngleDeg: hunchAngleDeg != null ? round1(hunchAngleDeg) : null, hunchFlag: classifyHunch(hunchAngleDeg), side: sides.length ? mode(sides) : null };
    }
    function stepGateOk(lm, vh) { return postureStep === 'side' ? sideOk(lm, vh) : fullBody(lm, vh); }
    function stepSample(lm) { return postureStep === 'side' ? sidePosture(lm) : frontPosture(lm); }
    function stepInstructions() {
      return postureStep === 'side'
        ? 'Step 2/2 — Turn 90° so the camera sees your SIDE profile. Stand naturally, arms relaxed — it captures itself once locked on, or clap/shout.'
        : 'Step 1/2 — Face the camera, feet together, arms relaxed at your sides — it captures itself once your whole body is in frame, or clap/shout.';
    }
    // Freeze the actual camera pixels onto the canvas at the moment of capture (clap,
    // countdown, or manual tap) — same privacy guarantee as always: a transient canvas
    // frame, discarded on close/retake, never sent or saved. Runs a FRESH, synchronous
    // pose read on the exact frame being captured (not whatever `lastLm` happens to be
    // from a prior loop tick, which can be stale on a stuttery relayed feed).
    function snapshotFrame() {
      var vw = camVideo.videoWidth, vh = camVideo.videoHeight;
      if (!vw || !vh) return false;
      camCanvas.width = vw; camCanvas.height = vh;
      var ctx = camCanvas.getContext('2d');
      ctx.drawImage(camVideo, 0, 0, vw, vh);
      var res = null; try { res = poseLm.detectForVideo(camVideo, performance.now()); } catch (e) {}
      var lm = res && res.landmarks && res.landmarks[0];
      if (!lm || !stepGateOk(lm, vh)) return false;
      lastLm = lm;
      drawSkeleton(ctx, lastLm, vw, vh);
      pendingPosture = stepSample(lastLm);
      return true;
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
        // no segmentation mask needed — posture reads joint ANGLES, not silhouette widths
      });
      poseMode = 'VIDEO';
      return poseLm;
    }
    async function setPoseMode(mode) {
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
      postureStep = 'front'; postureData = {}; captureSource = 'live';
      camOverlay.classList.remove('hidden'); camStatus.textContent = 'Starting…'; camMeasure.disabled = true; lastLm = null;
      autoStart = 0; lastGood = 0; samples = []; pendingPosture = null; camVideo.style.display = '';
      try {
        await setPoseMode('VIDEO');
        await refreshCamDevices();                     // labels are blank pre-permission on first-ever run, that's fine
        var chosen = camDevice && !camDevice.classList.contains('hidden') ? camDevice.value : '';
        var videoConstraints = chosen ? { deviceId: { exact: chosen }, width: 640, height: 480 } : { facingMode: 'user', width: 640, height: 480 };
        camStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });   // camera first — must succeed
        micUnavailableReason = '';
        try {                                           // mic is separate + optional — clap-to-capture only, never
          var aStream = await navigator.mediaDevices.getUserMedia({ audio: true });           // recorded/sent anywhere.
          aStream.getAudioTracks().forEach(function (t) { camStream.addTrack(t); });          // Requested on its own so a
        } catch (e) {                                                                          // mic-only failure (denied,
          micUnavailableReason = (e && e.name) || 'unavailable';                               // busy, no device) can't
        }                                                                                       // silently take the camera
        camVideo.srcObject = camStream; await camVideo.play();                                 // down with it.
        refreshCamDevices();                           // re-run now that permission is granted → real device labels
        startClapDetect(camStream);
        camStatus.textContent = stepInstructions(); loop();
      } catch (e) { camStatus.textContent = 'Couldn’t start: ' + ((e && e.message) || 'camera/model unavailable') + '.'; }
    }
    // Clap/loud-sound → capture now, for when you're too far to reach the button. Pure
    // on-device volume-peak detection (no speech-to-text, no audio ever recorded or sent
    // anywhere) — real word recognition would need a cloud speech API, which Brave mostly
    // doesn't even wire up, and would break the "nothing leaves your device" guarantee.
    var clapAnalyser = null, clapData = null, lastClapAt = 0, micUnavailableReason = '';
    var CLAP_THRESHOLD = 55;                          // tune against the live meter
    function startClapDetect(stream) {
      clapAnalyser = null; clapData = null;
      try {
        if (!stream.getAudioTracks().length) return;
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        var src = audioCtx.createMediaStreamSource(stream);
        clapAnalyser = audioCtx.createAnalyser();
        clapAnalyser.fftSize = 512;
        clapData = new Uint8Array(clapAnalyser.frequencyBinCount);
        src.connect(clapAnalyser);
      } catch (e) { clapAnalyser = null; clapData = null; }
    }
    function checkClap() {
      if (!clapAnalyser || !clapData) {                 // no live meter to show, but say WHY instead of just hiding it
        if (camMic) { camMic.classList.remove('hidden'); camMic.textContent = 'mic: ' + (micUnavailableReason || 'no audio track') + ' — clap/shout trigger off'; }
        return;
      }
      clapAnalyser.getByteTimeDomainData(clapData);
      var peak = 0;
      for (var i = 0; i < clapData.length; i++) { var v = Math.abs(clapData[i] - 128); if (v > peak) peak = v; }
      if (camMic) { camMic.classList.remove('hidden'); camMic.textContent = 'mic level: ' + peak + ' / trigger: ' + CLAP_THRESHOLD; }
      if (camMeasure.disabled || showDone) return;
      var now = performance.now();
      if (peak > CLAP_THRESHOLD && now - lastClapAt > 2000) {
        lastClapAt = now; beep();
        if (snapshotFrame()) onCaptured();
        else camStatus.textContent = 'Heard you, but couldn’t get a clean lock — stay in frame and try again.';
      }
    }
    var CONNECT = [[11,12],[11,23],[12,24],[23,24],[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[24,26],[26,28]];
    function loop() {
      if (!camStream || showDone) return;               // hold the "✓ Done" frame on screen, don't paint over it
      checkClap();
      if (showDone) return;                             // clap just fired this tick — don't paint over the ✓
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
          if (stepGateOk(lastLm, vh)) {
            lastGood = now;
            if (!autoStart) { autoStart = now; samples = []; }
            var est = stepSample(lastLm);
            if (est) samples.push(est);
            if (now - autoStart >= AUTO_MS) {
              snapshotFrame(); beep(); onCaptured();
              return;                                   // frame is frozen now — no more loop ticks until Retake
            }
            var left = Math.ceil((AUTO_MS - (now - autoStart)) / 1000);
            drawCount(ctx, vw, vh, left);
            camStatus.textContent = 'Hold still — capturing in ' + left + '…';
          } else {
            if (autoStart && now - lastGood > GRACE_MS) { autoStart = 0; samples = []; }
            camStatus.textContent = stepInstructions();
          }
        } else {
          camMeasure.disabled = true;
          if (autoStart && performance.now() - lastGood > GRACE_MS) { autoStart = 0; samples = []; }
        }
      }
      rafId = requestAnimationFrame(loop);
    }
    // Combine the countdown samples (if auto-capture ran) or the single frozen-frame
    // reading (clap/manual tap/photo) into this step's posture result, then show the
    // review UI (Retake/Confirm) — same "don't auto-close" pattern as the old measurement
    // scan: you get to see the frame before it's used.
    function onCaptured() {
      var reading;
      if (samples.length >= 5) reading = postureStep === 'side' ? combineSide(samples) : combineFront(samples);
      else if (pendingPosture) reading = postureStep === 'side' ? combineSide([pendingPosture]) : combineFront([pendingPosture]);
      else reading = null;
      autoStart = 0; samples = [];
      if (!reading) { msg('No clean pose detected — try again.'); return; }
      pendingPosture = reading;
      if (camCanvas && camCanvas.width) drawDone(camCanvas.getContext('2d'), camCanvas.width, camCanvas.height);
      camVideo.style.display = 'none';                 // show the frozen canvas frame, not the still-live video
      showDone = true; camMeasure.disabled = true;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }   // stop scanning — reviewing the frozen frame now
      camStatus.textContent = 'Captured — check the picture, then Retake or Confirm.';
      showReview(true);
      beepOk(); speakDone('Captured');
    }
    function showReview(on) {
      if (camMeasure) camMeasure.classList.toggle('hidden', on);
      if (camRetake) camRetake.classList.toggle('hidden', !on);
      if (camConfirm) camConfirm.classList.toggle('hidden', !on);
      if (camConfirm) camConfirm.textContent = (on && postureStep === 'front') ? 'Next: side view →' : '✓ Save posture check';
      if (camMic && on) camMic.classList.add('hidden');
    }
    function retakeCapture() {
      showDone = false; showReview(false); camMeasure.disabled = true; pendingPosture = null;
      if (captureSource === 'live' && camStream) {      // camera's still attached — just resume scanning
        camVideo.style.display = '';
        camCanvas.getContext('2d').clearRect(0, 0, camCanvas.width, camCanvas.height);
        autoStart = 0; lastGood = 0; samples = []; lastLm = null;
        camStatus.textContent = stepInstructions();
        loop();
      } else {                                          // photo mode — go straight back to the file picker
        photoInput && photoInput.click();
      }
    }
    function savePosture() {
      var payload = {}, k;
      for (k in postureData.front) payload[k] = postureData.front[k];
      for (k in postureData.side) payload[k] = postureData.side[k];
      fetch('/pug/api/physique', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ posture: payload }) })
        .then(function (r) { return r.json(); }).then(function (res) {
          if (res && res.error) { msg(res.error); return; }
          load(); msg('Posture check saved.');
        }).catch(function () { msg('Save failed.'); });
    }
    function confirmCapture() {
      if (postureStep === 'front') {
        postureData.front = pendingPosture;
        postureStep = 'side'; pendingPosture = null; showDone = false; showReview(false); camMeasure.disabled = true;
        if (captureSource === 'live' && camStream) {
          camVideo.style.display = '';
          camCanvas.getContext('2d').clearRect(0, 0, camCanvas.width, camCanvas.height);
          autoStart = 0; lastGood = 0; samples = []; lastLm = null;
          camStatus.textContent = stepInstructions();
          loop();
        } else {
          camStatus.textContent = stepInstructions();
          photoInput && photoInput.click();
        }
      } else {
        postureData.side = pendingPosture;
        closeCam();
        savePosture();
      }
    }
    // Analyze an uploaded photo for the CURRENT step — for when the webcam can't frame the
    // shot cleanly (laptop on a table, or need distance for a side profile). Read HERE in
    // the browser and discarded: never uploaded to the server or saved anywhere.
    async function openPhoto(file) {
      if (!camOverlay || !file) return;
      captureSource = 'photo';
      if (postureStep == null) { postureStep = 'front'; postureData = {}; }
      camOverlay.classList.remove('hidden'); camMeasure.disabled = true;
      camVideo.style.display = 'none';                // canvas shows the photo instead
      camStatus.textContent = 'Analyzing photo…';
      var url = URL.createObjectURL(file);
      try {
        await setPoseMode('VIDEO');                     // same detectForVideo() path the live capture uses
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
          if (stepGateOk(lastLm, vh)) { pendingPosture = stepSample(lastLm); onCaptured(); }
          else camStatus.textContent = 'Found a body, but not clearly enough for this step — try a photo showing ' +
            (postureStep === 'side' ? 'your full side profile' : 'your full front, head to feet') + '.';
        } else {
          camStatus.textContent = 'No body found in that photo — try a different one.';
        }
      } catch (e) {
        camStatus.textContent = 'Couldn’t read that photo — try a different one.';
      } finally { URL.revokeObjectURL(url); }
    }
    function closeCam() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (camStream) { camStream.getTracks().forEach(function (t) { t.stop(); }); camStream = null; }
      if (camVideo) { camVideo.srcObject = null; camVideo.style.display = ''; } lastLm = null;
      autoStart = 0; lastGood = 0; samples = []; pendingPosture = null; showDone = false;
      clapAnalyser = null; clapData = null;
      postureStep = null; postureData = {};
      showReview(false);
      // wipe any uploaded photo off the canvas — nothing lingers behind the hidden overlay
      if (camCanvas && camCanvas.width) camCanvas.getContext('2d').clearRect(0, 0, camCanvas.width, camCanvas.height);
      if (camOverlay) camOverlay.classList.add('hidden');
    }
    scanBtn && scanBtn.addEventListener('click', openCam);
    photoBtn && photoBtn.addEventListener('click', function () {
      postureStep = 'front'; postureData = {}; captureSource = 'photo';
      photoInput && photoInput.click();
    });
    photoInput && photoInput.addEventListener('change', function () {
      openPhoto(photoInput.files && photoInput.files[0]);
      photoInput.value = '';                          // so re-picking the same file re-fires change
    });
    camMeasure && camMeasure.addEventListener('click', function () {
      if (camStream && !snapshotFrame()) { msg('Couldn’t get a clean lock — reposition and try again.'); return; }
      onCaptured();
    });
    camClose && camClose.addEventListener('click', closeCam);
    camRetake && camRetake.addEventListener('click', retakeCapture);
    camConfirm && camConfirm.addEventListener('click', confirmCapture);

    // "How to measure" guide — plain reference, no camera/state involved.
    var howBtn = document.getElementById('physHowBtn'), howOverlay = document.getElementById('physHowOverlay'),
        howClose = document.getElementById('physHowClose');
    howBtn && howBtn.addEventListener('click', function () { howOverlay && howOverlay.classList.remove('hidden'); });
    howClose && howClose.addEventListener('click', function () { howOverlay && howOverlay.classList.add('hidden'); });

    document.addEventListener('veyra:navigate', function (e) { if (e.detail && e.detail.route === 'physique') load(); });
    load();
  });
})();
