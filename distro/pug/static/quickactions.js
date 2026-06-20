/**
 * quickactions.js — the Quick Actions sidebar card.
 * For now it holds one tool: a focus countdown timer (presets, start/pause, reset,
 * beep + flash + optional notification when it hits zero). More actions can be added
 * to the card later.
 */
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var display = document.getElementById('qaTimerDisplay');
    var toggle  = document.getElementById('qaTimerToggle');
    var reset   = document.getElementById('qaTimerReset');
    if (!display || !toggle || !reset) return;
    var presets = document.querySelectorAll('.qa-preset');

    var totalSec  = 25 * 60;   // selected duration
    var remaining = totalSec;
    var running   = false;
    var endAt     = 0;
    var tick      = null;

    function fmt(s) {
      s = Math.max(0, Math.round(s));
      var m = Math.floor(s / 60), sec = s % 60;
      return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
    }
    function render() { display.textContent = fmt(remaining); }
    function stopTick() { if (tick) { clearInterval(tick); tick = null; } }

    function start() {
      running = true;
      toggle.textContent = 'Pause';
      toggle.classList.remove('qa-btn-go');
      endAt = Date.now() + remaining * 1000;
      tick = setInterval(function () {
        remaining = (endAt - Date.now()) / 1000;
        if (remaining <= 0) { remaining = 0; render(); finish(); return; }
        render();
      }, 250);
    }
    function pause() {
      running = false;
      toggle.textContent = 'Start';
      toggle.classList.add('qa-btn-go');
      stopTick();
    }
    function finish() {
      stopTick();
      running = false;
      toggle.textContent = 'Start';
      toggle.classList.add('qa-btn-go');
      display.classList.add('qa-timer-done');
      setTimeout(function () { display.classList.remove('qa-timer-done'); }, 4000);
      beep();
      if (window.Notification && Notification.permission === 'granted') {
        try { new Notification('Timer done', { body: 'Your Quick Actions timer finished.' }); } catch (e) {}
      }
    }
    function beep() {
      try {
        var ac = new (window.AudioContext || window.webkitAudioContext)();
        var o = ac.createOscillator(), g = ac.createGain();
        o.connect(g); g.connect(ac.destination);
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.001, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.3, ac.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.6);
        o.start(); o.stop(ac.currentTime + 0.62);
      } catch (e) {}
    }

    toggle.addEventListener('click', function () { running ? pause() : start(); });
    reset.addEventListener('click', function () { pause(); remaining = totalSec; render(); });

    presets.forEach(function (b) {
      b.addEventListener('click', function () {
        presets.forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        totalSec  = parseInt(b.dataset.min, 10) * 60;
        pause();
        remaining = totalSec;
        render();
        if (window.Notification && Notification.permission === 'default') {
          try { Notification.requestPermission(); } catch (e) {}
        }
      });
    });

    render();
  });
})();
