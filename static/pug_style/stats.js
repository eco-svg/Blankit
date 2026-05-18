document.addEventListener('DOMContentLoaded', () => {

    const modal           = document.getElementById('statsModal');
    const btn      = document.getElementById('statsBtn');
    const closeBtn = document.querySelector('#statsModal .close-modal');
    const classNameEl     = document.getElementById('statClassName');
    const personalityEl   = document.getElementById('statPersonality');
    const personalityDesc = document.getElementById('statPersonalityDesc');
    const bioEl           = document.getElementById('statBio');
    const skillsListEl    = document.getElementById('statSkillsList');
    const rankBadgeEl        = document.getElementById('headerRankBadge');
    const statsPopupRankBadge = document.getElementById('statsPopupRankBadge');
    const skillsMainList     = document.getElementById('skillsMainList');
    const reanalyzeBtn       = document.getElementById('reanalyzeBtn');

    let sheet = null;

    // Full rank ladder — all caps
    const RANK_COLORS = {
        'S+': '#ffd700',
        'S':  '#ffb700',
        'S-': '#ffa500',
        'A+': '#ff7c4d',
        'A':  '#ff8c42',
        'A-': '#e8854a',
        'B+': '#5a8fc8',
        'B':  '#4a7aaa',
        'B-': '#4070a0',
        'C+': '#8ac888',
        'C':  '#78b878',
        'C-': '#68a068',
        'D+': '#a0a0a0',
        'D':  '#888888',
        'D-': '#707070',
        'E':  '#c06030',
        'F':  '#803010',
    };

    const RANK_ORDER = ['S+','S','S-','A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','E','F'];

    // ── Popup open/close ────────────────────────────────────────────────────
    function openStats() {
        modal.classList.add('visible');
        if (sheet) { renderModal(); }
        else { fetchStats(false); }
    }
    function closeStats() { modal.classList.remove('visible'); }

    btn?.addEventListener('click', e => { e.stopPropagation(); openStats(); });
    reanalyzeBtn?.addEventListener('click', e => { e.stopPropagation(); fetchStats(true); });
    closeBtn?.addEventListener('click', closeStats);

    // Click outside the popup to close
    document.addEventListener('click', e => {
        if (modal.classList.contains('visible') && !modal.contains(e.target) && e.target !== btn) {
            closeStats();
        }
    });

    // ── Render helpers ──────────────────────────────────────────────────────
    function normaliseRank(raw) {
        if (!raw) return 'F';
        const r = raw.trim().toUpperCase();
        return RANK_ORDER.includes(r) ? r : 'F';
    }

    function skillRowHTML(s) {
        const rank  = normaliseRank(s.rank);
        const color = RANK_COLORS[rank] || '#888';
        const glow  = rank === 'S+' ? `text-shadow:0 0 10px ${color};` : '';
        const isVerified = s.verified !== false;
        const note  = s.note
            ? `<span class="skill-note">${s.note}</span>` : '';
        const rankHtml = isVerified
            ? `<span class="rank-badge" style="color:${color};${glow}">${rank}</span>`
            : `<span class="rank-badge rank-unverified" title="Verify an achievement to unlock rank">?</span>`;
        return `
            <div class="skill-row">
                <span class="skill-name-wrap">
                    <span class="skill-name">${s.name || '—'}</span>
                    ${note}
                </span>
                ${rankHtml}
            </div>`;
    }

    function renderSkills(skills, container) {
        if (!container) return;
        if (!skills || !skills.length) {
            container.innerHTML = '<div class="skill-loading">No skill data yet.</div>';
            return;
        }
        const sorted = [...skills].sort((a, b) => {
            const av = a.verified !== false, bv = b.verified !== false;
            if (av !== bv) return av ? -1 : 1;
            return RANK_ORDER.indexOf(normaliseRank(a.rank)) - RANK_ORDER.indexOf(normaliseRank(b.rank));
        });
        container.innerHTML = sorted.map(s => skillRowHTML(s)).join('');
    }

    function netRank(skills) {
        if (!skills || !skills.length) return null;
        const verified = skills.filter(s => s.verified !== false);
        if (!verified.length) return null;
        for (const r of RANK_ORDER) {
            if (verified.some(s => normaliseRank(s.rank) === r)) return r;
        }
        return null;
    }

    function updateRankBadge() {
        if (!sheet) return;
        const r = netRank(sheet.skills);
        const color = RANK_COLORS[r] || '#888';

        // Header badge (visible only if rank is meaningful)
        if (rankBadgeEl) {
            if (!r || r === 'F') { rankBadgeEl.classList.remove('visible'); }
            else {
                rankBadgeEl.textContent = r;
                rankBadgeEl.style.color = color;
                rankBadgeEl.style.borderColor = color;
                rankBadgeEl.style.textShadow = r === 'S+' ? `0 0 8px ${color}` : '';
                rankBadgeEl.classList.add('visible');
            }
        }

        // Stats popup badge (always shown when we have a rank)
        if (statsPopupRankBadge) {
            if (!r) { statsPopupRankBadge.style.display = 'none'; }
            else {
                statsPopupRankBadge.textContent = r;
                statsPopupRankBadge.style.color = color;
                statsPopupRankBadge.style.borderColor = color;
                statsPopupRankBadge.style.textShadow = r === 'S+' ? `0 0 8px ${color}` : '';
                statsPopupRankBadge.style.display = '';
            }
        }
    }

    function reapplyStatsLabels() {
        // Re-translate static data-i18n labels inside the stats popup after JS renders
        const popup = document.getElementById('statsModal');
        if (!popup || !window.i18nGet) return;
        popup.querySelectorAll('[data-i18n]').forEach(el => {
            const v = window.i18nGet(el.dataset.i18n);
            if (v !== null) el.textContent = v;
        });
    }

    function renderModal() {
        if (!sheet) return;
        if (classNameEl)     classNameEl.textContent     = sheet.class_official || '—';
        if (personalityEl)   personalityEl.textContent   = sheet.personality    || '—';
        if (personalityDesc) personalityDesc.textContent = sheet.personality_desc || '';
        if (bioEl)           bioEl.textContent           = sheet.bio || '';
        renderSkills(sheet.skills, skillsListEl);
        reapplyStatsLabels();
    }

    function renderMainCard() {
        if (!skillsMainList) return;
        if (!sheet || !sheet.skills?.length) {
            skillsMainList.innerHTML = '<div class="skill-loading" style="margin-top:30px;">Click <strong>analyze</strong> or open STATS to detect your skills.</div>';
            return;
        }
        const sorted = [...sheet.skills].sort((a, b) =>
            RANK_ORDER.indexOf(normaliseRank(a.rank)) - RANK_ORDER.indexOf(normaliseRank(b.rank)));
        skillsMainList.innerHTML = sorted.map(s => skillRowHTML(s)).join('');
    }

    // ── Fetch stats ─────────────────────────────────────────────────────────
    async function fetchStats(forceRefresh) {
        if (classNameEl)     classNameEl.textContent     = 'Analyzing...';
        if (personalityEl)   personalityEl.textContent   = '—';
        if (personalityDesc) personalityDesc.textContent = '';
        if (bioEl)           bioEl.textContent           = '';
        if (skillsListEl)    skillsListEl.innerHTML      = '<div class="skill-loading">Scanning data...</div>';
        if (skillsMainList)  skillsMainList.innerHTML    = '<div class="skill-loading">Scanning...</div>';

        try {
            const url = '/pug/api/stats' + (forceRefresh ? '?refresh=true' : '');
            const res  = await fetch(url);
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();

            sheet = data.sheet;
            renderModal();
            renderMainCard();
            updateRankBadge();
        } catch {
            if (classNameEl)  classNameEl.textContent  = 'Error';
            if (skillsListEl) skillsListEl.innerHTML   = '<div class="skill-loading">Could not load — try again.</div>';
        }
    }

    // ── Midnight auto-refresh ───────────────────────────────────────────────
    function scheduleMidnightRefresh() {
        const now  = new Date();
        const next = new Date(now);
        next.setDate(now.getDate() + 1);
        next.setHours(0, 0, 5, 0);
        setTimeout(() => {
            fetchStats(true);
            scheduleMidnightRefresh();
        }, next - now);
    }
    scheduleMidnightRefresh();

    // ── Page-load silent cache fetch ────────────────────────────────────────
    fetch('/pug/api/stats?cache_only=true')
        .then(r => r.json())
        .then(data => {
            if (data.sheet) {
                sheet = data.sheet;
                renderMainCard();
                updateRankBadge();
            }
        })
        .catch(() => {});

    // ── Re-translate when user switches language ─────────────────────────────
    window.addEventListener('langChanged', () => {
        reapplyStatsLabels();
        if (sheet && modal.classList.contains('visible')) {
            renderModal();
        }
    });

});
