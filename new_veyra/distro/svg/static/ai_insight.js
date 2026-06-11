/* ═══════════════════════════════════════
   ai_insight.js — live AI insight card
   Include in home.html just before </body>
═══════════════════════════════════════ */

(async function loadInsight() {
  const card = document.getElementById('aiCard');
  if (!card) return;

  // Replace "coming soon" content with live card
  card.innerHTML = `
    <div class="ai-card-header">
      <span class="ai-badge">◈ AI</span>
      <button class="ai-refresh-btn" id="aiRefresh" title="New insight">↻</button>
    </div>
    <p class="ai-insight-text" id="aiInsight">Loading insight...</p>
    <a href="/manifestation" class="cs-mini-link" style="margin-top:0.6rem">
      ✦ Open manifestation →
    </a>
  `;

  async function fetchInsight() {
    const el = document.getElementById('aiInsight');
    if (!el) return;

    el.textContent = 'Thinking...';

    try {
      const res = await fetch('/ai/insight');
      const data = await res.json();

      el.textContent = res.ok
        ? data.insight
        : (data.error || 'AI unavailable right now.');

    } catch {
      el.textContent = 'Could not reach AI — is Ollama running?';
    }
  }

  await fetchInsight();

  document.getElementById('aiRefresh')
    ?.addEventListener('click', fetchInsight);

})();