document.addEventListener('DOMContentLoaded', () => {

    const btn             = document.getElementById('statsBtn');
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
    let benchmarks = null;

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
    // Major ranks used in benchmark lookups (no +/-)
    const MAJOR_RANKS = ['S+','S','A','B','C','D','E','F'];

    // ── Stats tab navigation ────────────────────────────────────────────────
    function openStats() {
        if (window._veyraNavigate) window._veyraNavigate('stats', true);
        if (sheet) { renderModal(); }
        else { fetchStats(false); }
    }

    btn?.addEventListener('click', e => { e.stopPropagation(); openStats(); });
    reanalyzeBtn?.addEventListener('click', e => { e.stopPropagation(); fetchStats(true); });

    // ── Benchmark helpers ───────────────────────────────────────────────────
    function fetchBenchmarks() {
        fetch('/pug_style/skill_benchmarks.json')
            .then(r => r.json())
            .then(data => {
                benchmarks = data;
                if (sheet) { renderMainCard(); }
            })
            .catch(() => {});
    }

    function getBenchmark(skillName) {
        if (!benchmarks || !skillName) return null;
        const name = skillName.trim();
        if (benchmarks[name]) return benchmarks[name];
        // fuzzy: case-insensitive + partial match
        const key = Object.keys(benchmarks).find(k =>
            k.toLowerCase() === name.toLowerCase() ||
            name.toLowerCase().includes(k.toLowerCase()) ||
            k.toLowerCase().includes(name.toLowerCase())
        );
        return key ? benchmarks[key] : null;
    }

    function rankIndexInBenchmark(bm, rank) {
        const r = rank.trim().toUpperCase();
        // try exact, then strip modifier
        let idx = bm.ranks.findIndex(x => x.rank === r);
        if (idx === -1) {
            const base = r.replace(/[+-]/, '');
            idx = bm.ranks.findIndex(x => x.rank === base);
        }
        return idx;
    }

    function nextBenchmarkRank(bm, currentRank) {
        const idx = rankIndexInBenchmark(bm, currentRank);
        if (idx <= 0) return null;
        return bm.ranks[idx - 1]; // ranks are ordered F→S+ (ascending), but we store F first so go left
    }

    // progress 0–1 based on position in ladder
    function rankProgress(bm, currentRank) {
        const total = bm.ranks.length - 1; // F is index 0
        const idx   = rankIndexInBenchmark(bm, currentRank);
        if (idx < 0 || total === 0) return 0;
        return idx / total;
    }

    // ── Render helpers ──────────────────────────────────────────────────────
    function normaliseRank(raw) {
        if (!raw) return 'F';
        const r = raw.trim().toUpperCase();
        return RANK_ORDER.includes(r) ? r : 'F';
    }

    function skillRowHTML(s, showProgression) {
        const rank  = normaliseRank(s.rank);
        const color = RANK_COLORS[rank] || '#888';
        const glow  = rank === 'S+' ? `text-shadow:0 0 10px ${color};` : '';
        const isVerified = s.verified !== false;
        const context = s.context
            ? `<span class="skill-context">${s.context}</span>` : '';
        const note  = s.note
            ? `<span class="skill-note">${s.note}</span>` : '';
        const rankHtml = isVerified
            ? `<span class="rank-badge" style="color:${color};${glow}">${rank}</span>`
            : `<span class="rank-badge rank-unverified" title="Verify an achievement to unlock rank">?</span>`;

        if (!showProgression) {
            return `
            <div class="skill-row">
                <span class="skill-name-wrap">
                    <span class="skill-name">${s.name || '—'}</span>
                    ${context}
                    ${note}
                </span>
                ${rankHtml}
            </div>`;
        }

        // Progression-enhanced row (main card, desktop)
        const bm   = getBenchmark(s.name);
        let progressBar = '';
        let nextLine    = '';

        if (bm && isVerified) {
            const pct      = Math.round(rankProgress(bm, rank) * 100);
            const nextRank = nextBenchmarkRank(bm, rank);
            const barColor = color;

            progressBar = `
            <div class="skill-progress-track">
                <div class="skill-progress-fill" style="width:${pct}%;background:${barColor};box-shadow:0 0 6px ${barColor}33;"></div>
            </div>`;

            if (nextRank && rank !== 'S+') {
                nextLine = `<div class="skill-next">next <span class="skill-next-rank" style="color:${RANK_COLORS[nextRank.rank]||'#aaa'}">${nextRank.rank}</span> — ${nextRank.label}</div>`;
            } else if (rank === 'S+') {
                nextLine = `<div class="skill-next skill-maxed">peak rank achieved</div>`;
            }
        } else if (!isVerified) {
            nextLine = `<div class="skill-next skill-unverified-hint">${s.note || 'Add proof to unlock rank'}</div>`;
        }

        const expandBtn = bm
            ? `<button class="skill-ladder-btn" data-skill="${s.name}" title="Show rank ladder">···</button>`
            : '';

        return `
        <div class="skill-row skill-row-prog" data-skill="${s.name}">
            <div class="skill-row-main">
                <span class="skill-name-wrap">
                    <span class="skill-name">${s.name || '—'}</span>
                    ${context}
                    ${note}
                </span>
                <div class="skill-row-right">
                    ${expandBtn}
                    ${rankHtml}
                </div>
            </div>
            ${progressBar}
            ${nextLine}
        </div>`;
    }

    function ladderHTML(skillName, currentRank) {
        const bm = getBenchmark(skillName);
        if (!bm) return '';
        const rank = normaliseRank(currentRank);
        const rows = [...bm.ranks].reverse().map(r => {
            const isCurrent = r.rank === rank ||
                r.rank === rank.replace(/[+-]/, '');
            const color = RANK_COLORS[r.rank] || '#888';
            const activeStyle = isCurrent
                ? `background:rgba(${hexToRgb(color)},0.12);border-color:${color}40;`
                : '';
            const bullet = isCurrent
                ? `<span style="color:${color};font-weight:700;">▶</span>`
                : `<span style="opacity:0.2">·</span>`;
            return `
            <div class="ladder-row${isCurrent ? ' ladder-current' : ''}" style="${activeStyle}">
                ${bullet}
                <span class="ladder-rank" style="color:${color}">${r.rank}</span>
                <span class="ladder-label">${r.label}</span>
                ${r.proof ? `<span class="ladder-proof">${r.proof}</span>` : ''}
            </div>`;
        }).join('');
        return `<div class="skill-ladder" id="ladder-${skillName.replace(/\s/g,'_')}">${rows}</div>`;
    }

    function hexToRgb(hex) {
        const r = parseInt(hex.slice(1,3),16);
        const g = parseInt(hex.slice(3,5),16);
        const b = parseInt(hex.slice(5,7),16);
        return isNaN(r) ? '128,128,128' : `${r},${g},${b}`;
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
        container.innerHTML = sorted.map(s => skillRowHTML(s, false)).join('');
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
        const statsCard = document.getElementById('sec-stats');
        if (!statsCard || !window.i18nGet) return;
        statsCard.querySelectorAll('[data-i18n]').forEach(el => {
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
        skillsMainList.innerHTML = sorted.map(s => skillRowHTML(s, true)).join('');
        wireSkillLadderBtns();
    }

    function wireSkillLadderBtns() {
        if (!skillsMainList) return;
        skillsMainList.querySelectorAll('.skill-ladder-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const skillName = btn.dataset.skill;
                const row = btn.closest('.skill-row-prog');
                if (!row) return;
                const ladderId = `ladder-${skillName.replace(/\s/g,'_')}`;
                const existing = row.querySelector('.skill-ladder');
                if (existing) { existing.remove(); btn.textContent = '···'; return; }
                const rank = row.querySelector('.rank-badge')?.textContent?.trim() || 'F';
                const html = ladderHTML(skillName, rank === '?' ? 'F' : rank);
                if (html) {
                    row.insertAdjacentHTML('beforeend', html);
                    btn.textContent = '✕';
                }
            });
        });
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
    fetchBenchmarks();
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
        if (sheet) renderModal();
    });

});
