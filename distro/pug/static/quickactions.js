/**
 * quickactions.js — the Quick Actions sidebar card.
 * For now: one minimal tool — a 25-minute focus timer. Click the time to start/pause,
 * "reset" to clear. Beeps + flashes when it hits zero. Kept deliberately tiny; more
 * quick actions will share this card later.
 */
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var display = document.getElementById('qaTimerDisplay');
    var reset   = document.getElementById('qaTimerReset');
    if (!display) return;

    var totalSec  = 25 * 60;
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
      display.classList.add('qa-running');
      endAt = Date.now() + remaining * 1000;
      tick = setInterval(function () {
        remaining = (endAt - Date.now()) / 1000;
        if (remaining <= 0) { remaining = 0; render(); finish(); return; }
        render();
      }, 250);
    }
    function pause() {
      running = false;
      display.classList.remove('qa-running');
      stopTick();
    }
    function finish() {
      pause();
      display.classList.add('qa-timer-done');
      setTimeout(function () { display.classList.remove('qa-timer-done'); }, 4000);
      beep();
      if (window.Notification && Notification.permission === 'granted') {
        try { new Notification('Timer done', { body: 'Your focus timer finished.' }); } catch (e) {}
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

    function toggle() {
      running ? pause() : start();
      if (window.Notification && Notification.permission === 'default') {
        try { Notification.requestPermission(); } catch (e) {}
      }
    }

    display.addEventListener('click', toggle);
    display.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    if (reset) reset.addEventListener('click', function () { pause(); remaining = totalSec; render(); });

    render();
  });
})();
