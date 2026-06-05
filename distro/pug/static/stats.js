document.addEventListener('DOMContentLoaded', () => {

    const btn                = document.getElementById('statsBtn');
    const classNameEl        = document.getElementById('statClassName');
    const personalityEl      = document.getElementById('statPersonality');
    const personalityDesc    = document.getElementById('statPersonalityDesc');
    const bioEl              = document.getElementById('statBio');
    const skillsListEl       = document.getElementById('statSkillsList');
    const rankBadgeEl        = document.getElementById('headerRankBadge');
    const statsPopupRankBadge= document.getElementById('statsPopupRankBadge');
    const skillsMainList     = document.getElementById('skillsMainList');
    const reanalyzeBtn       = document.getElementById('reanalyzeBtn');

    let sheet      = null;
    let benchmarks = null;
    let expConfig  = null;

    const RANK_COLORS = {
        'S+': '#ffd700', 'S': '#ffb700', 'S-': '#ffa500',
        'A+': '#ff7c4d', 'A': '#ff8c42', 'A-': '#e8854a',
        'B+': '#5a8fc8', 'B': '#4a7aaa', 'B-': '#4070a0',
        'C+': '#8ac888', 'C': '#78b878', 'C-': '#68a068',
        'D+': '#a0a0a0', 'D': '#888888', 'D-': '#707070',
        'E+': '#d07040', 'E': '#c06030', 'E-': '#a05020',
        'F':  '#803010',
    };
    const RANK_ORDER = ['S+','S','S-','A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','E+','E','E-','F'];

    // ── Navigation ──────────────────────────────────────────────────────────
    function openStats() {
        if (window._veyraNavigate) window._veyraNavigate('stats', true);
        if (sheet) renderModal(); else fetchStats(false);
    }
    btn?.addEventListener('click', e => { e.stopPropagation(); openStats(); });
    reanalyzeBtn?.addEventListener('click', e => { e.stopPropagation(); fetchStats(true); });

    // ── Benchmarks + EXP config ──────────────────────────────────────────────
    function fetchBenchmarks() {
        fetch('/pug_style/skill_benchmarks.json')
            .then(r => r.json())
            .then(data => { benchmarks = data; if (sheet) renderMainCard(); })
            .catch(() => {});
    }

    function fetchExpConfig() {
        fetch('/pug_style/exp_config.json')
            .then(r => r.json())
            .then(data => { expConfig = data; })
            .catch(() => {});
    }

    function fmtExp(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 1000)    return Math.round(n / 1000) + 'K';
        return String(n);
    }

    function getBenchmark(skillName) {
        if (!benchmarks || !skillName) return null;
        const name = skillName.trim();
        if (benchmarks[name]) return benchmarks[name];
        const key = Object.keys(benchmarks).find(k =>
            k.toLowerCase() === name.toLowerCase() ||
            name.toLowerCase().includes(k.toLowerCase()) ||
            k.toLowerCase().includes(name.toLowerCase())
        );
        return key ? benchmarks[key] : null;
    }

    // ── Rank helpers ─────────────────────────────────────────────────────────
    function normaliseRank(raw) {
        if (!raw) return 'F';
        const r = raw.trim().toUpperCase();
        return RANK_ORDER.includes(r) ? r : 'F';
    }

    function rankIndexInClass(cls, rank) {
        const r = rank.toUpperCase();
        let idx = cls.ranks.findIndex(x => x.rank === r);
        if (idx === -1) idx = cls.ranks.findIndex(x => x.rank === r.replace(/[+-]/,''));
        return idx;
    }

    function rankProgress(cls, rank) {
        const total = cls.ranks.length - 1;
        const idx   = rankIndexInClass(cls, rank);
        return (idx < 0 || total === 0) ? 0 : idx / total;
    }

    function nextRankInClass(cls, rank) {
        const idx = rankIndexInClass(cls, rank);
        return (idx > 0) ? cls.ranks[idx - 1] : null;
    }

    function hexToRgb(hex) {
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        return isNaN(r) ? '128,128,128' : `${r},${g},${b}`;
    }

    // ── Skill row HTML ───────────────────────────────────────────────────────
    function skillRowHTML(s, withProgression) {
        const rank     = normaliseRank(s.rank);
        const color    = RANK_COLORS[rank] || '#888';
        const glow     = rank === 'S+' ? `text-shadow:0 0 10px ${color};` : '';
        const verified = s.verified !== false;
        const context  = s.context ? `<span class="skill-context">${s.context}</span>` : '';
        const note     = s.note    ? `<span class="skill-note">${s.note}</span>`    : '';
        const badgeHtml = verified
            ? `<span class="rank-badge" style="color:${color};${glow}">${rank}</span>`
            : `<span class="rank-badge rank-unverified" title="Verify an achievement to unlock rank">?</span>`;

        if (!withProgression) return `
            <div class="skill-row">
                <span class="skill-name-wrap"><span class="skill-name">${s.name||'—'}</span>${context}${note}</span>
                ${badgeHtml}
            </div>`;

        const bm = getBenchmark(s.name);
        let progressBar = '', nextLine = '', expandBtn = '';

        if (bm) {
            if (bm.type === 'exp') {
                // Dummy EXP bar — real system wired later
                progressBar = `
                <div class="skill-progress-track">
                    <div class="skill-progress-fill skill-exp-fill" style="width:0%;background:${color};"></div>
                </div>`;
                nextLine = `<div class="skill-next skill-exp-hint">EXP — community engagement tracking coming soon</div>`;
                expandBtn = `<button class="skill-ladder-btn" data-skill="${s.name}" data-bm-type="exp" title="Show classes">···</button>`;
            } else {
                // Metric — use first class by default
                const cls = bm.classes?.[0];
                if (cls && verified) {
                    const pct  = Math.round(rankProgress(cls, rank) * 100);
                    const next = nextRankInClass(cls, rank);
                    progressBar = `
                    <div class="skill-progress-track">
                        <div class="skill-progress-fill" style="width:${pct}%;background:${color};box-shadow:0 0 6px ${color}33;"></div>
                    </div>`;
                    if (next && rank !== 'S+') {
                        nextLine = `<div class="skill-next">next <span class="skill-next-rank" style="color:${RANK_COLORS[next.rank]||'#aaa'}">${next.rank}</span> — ${next.label}${next.threshold ? ` <span class="skill-threshold">(${next.threshold})</span>` : ''}</div>`;
                    } else if (rank === 'S+') {
                        nextLine = `<div class="skill-next skill-maxed">peak rank achieved</div>`;
                    }
                } else if (!verified) {
                    progressBar = `<div class="skill-progress-track"><div class="skill-progress-fill" style="width:8%;background:${color}44;"></div></div>`;
                    nextLine = `<div class="skill-next skill-unverified-hint">${s.note || 'Add proof in Achievements to unlock rank'}</div>`;
                }
                expandBtn = `<button class="skill-ladder-btn" data-skill="${s.name}" data-bm-type="metric" title="Show rank ladder">···</button>`;
            }
        }

        return `
        <div class="skill-row skill-row-prog" data-skill="${s.name}">
            <div class="skill-row-main">
                <span class="skill-name-wrap"><span class="skill-name">${s.name||'—'}</span>${context}${note}</span>
                <div class="skill-row-right">${expandBtn}${badgeHtml}</div>
            </div>
            ${progressBar}
            ${nextLine}
        </div>`;
    }

    // ── Ladder HTML (metric) ─────────────────────────────────────────────────
    function metricLadderHTML(skillName, currentRank, bm) {
        const rank    = normaliseRank(currentRank);
        // Class tabs
        const tabs = bm.classes.map((cls, i) => `
            <button class="ladder-class-tab${i===0?' active':''}" data-cls-idx="${i}">${cls.label}</button>`
        ).join('');

        const classBlocks = bm.classes.map((cls, i) => {
            const rows = [...cls.ranks].reverse().map(r => {
                const isCurrent = r.rank === rank || r.rank === rank.replace(/[+-]/,'');
                const c = RANK_COLORS[r.rank] || '#888';
                const bullet = isCurrent ? `<span style="color:${c};font-weight:700;">▶</span>` : `<span style="opacity:0.2">·</span>`;
                const activeStyle = isCurrent ? `background:rgba(${hexToRgb(c)},0.12);border-color:${c}40;` : '';
                return `
                <div class="ladder-row${isCurrent?' ladder-current':''}" style="${activeStyle}">
                    ${bullet}
                    <span class="ladder-rank" style="color:${c}">${r.rank}</span>
                    <span class="ladder-label">${r.label}</span>
                    ${r.threshold ? `<span class="ladder-proof">${r.threshold}</span>` : ''}
                </div>`;
            }).join('');
            return `<div class="ladder-class-block${i===0?'':' hidden'}" data-cls-idx="${i}">${rows}</div>`;
        }).join('');

        const note = bm.classes[0]?.note ? `<div class="ladder-note">${bm.classes[0].note}</div>` : '';

        return `
        <div class="skill-ladder skill-ladder-metric">
            ${bm.classes.length > 1 ? `<div class="ladder-class-tabs">${tabs}</div>` : ''}
            ${note}
            <div class="ladder-class-blocks">${classBlocks}</div>
        </div>`;
    }

    // ── EXP ladder HTML ──────────────────────────────────────────────────────
    function expLadderHTML(bm) {
        const classList = bm.classes.map(c => `<span class="exp-class-chip">${c.label}</span>`).join('');

        const EXP_RANKS = ['S+','S','S-','A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','E+','E','E-','F'];
        const thresholds = expConfig?.rank_thresholds || {};
        const rankRows = EXP_RANKS.map(r => {
            const xp  = thresholds[r];
            const c   = RANK_COLORS[r] || '#888';
            const xpLabel = (xp != null && xp > 0) ? `<span class="exp-threshold-label">${fmtExp(xp)} XP</span>` : '';
            const isSubRank = r.includes('+') || r.includes('-');
            return `<div class="exp-rank-row${isSubRank ? ' exp-subrank' : ''}">
                <span class="ladder-rank" style="color:${c}">${r}</span>
                ${xpLabel}
            </div>`;
        }).join('');

        return `
        <div class="skill-ladder skill-ladder-exp">
            <div class="exp-ladder-classes">${classList}</div>
            <div class="exp-rank-ladder">${rankRows}</div>
            <div class="exp-ladder-msg">
                <span style="opacity:0.5;font-size:0.72rem;">Earned from: likes · comments · shares · saves · follows · DMs · collabs · hires</span>
                <br><span style="opacity:0.35;font-size:0.65rem;">Tracking coming soon — posts count retroactively.</span>
            </div>
        </div>`;
    }

    // ── Wire expand buttons ──────────────────────────────────────────────────
    function wireSkillLadderBtns() {
        if (!skillsMainList) return;
        skillsMainList.querySelectorAll('.skill-ladder-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const row = btn.closest('.skill-row-prog');
                if (!row) return;
                const existing = row.querySelector('.skill-ladder');
                if (existing) { existing.remove(); btn.textContent = '···'; return; }

                const skillName = btn.dataset.skill;
                const bm        = getBenchmark(skillName);
                if (!bm) return;

                const rankEl = row.querySelector('.rank-badge');
                const rank   = rankEl?.textContent?.trim() === '?' ? 'F' : (rankEl?.textContent?.trim() || 'F');
                const html   = bm.type === 'exp'
                    ? expLadderHTML(bm)
                    : metricLadderHTML(skillName, rank, bm);

                row.insertAdjacentHTML('beforeend', html);
                btn.textContent = '✕';

                // Wire class tab switching
                row.querySelectorAll('.ladder-class-tab').forEach(tab => {
                    tab.addEventListener('click', () => {
                        const idx = +tab.dataset.clsIdx;
                        row.querySelectorAll('.ladder-class-tab').forEach(t => t.classList.toggle('active', +t.dataset.clsIdx === idx));
                        row.querySelectorAll('.ladder-class-block').forEach(b => b.classList.toggle('hidden', +b.dataset.clsIdx !== idx));
                        // Update note
                        const cls = bm.classes[idx];
                        const noteEl = row.querySelector('.ladder-note');
                        if (noteEl) noteEl.textContent = cls?.note || '';
                    });
                });
            });
        });
    }

    // ── Render helpers ───────────────────────────────────────────────────────
    function renderSkills(skills, container) {
        if (!container) return;
        if (!skills?.length) { container.innerHTML = '<div class="skill-loading">No skill data yet.</div>'; return; }
        const sorted = [...skills].sort((a, b) => {
            const av = a.verified !== false, bv = b.verified !== false;
            if (av !== bv) return av ? -1 : 1;
            return RANK_ORDER.indexOf(normaliseRank(a.rank)) - RANK_ORDER.indexOf(normaliseRank(b.rank));
        });
        container.innerHTML = sorted.map(s => skillRowHTML(s, false)).join('');
    }

    function renderMainCard() {
        if (!skillsMainList) return;
        if (!sheet?.skills?.length) {
            skillsMainList.innerHTML = '<div class="skill-loading" style="margin-top:30px;">Click <strong>analyze</strong> or open STATS to detect your skills.</div>';
            return;
        }
        const sorted = [...sheet.skills].sort((a, b) =>
            RANK_ORDER.indexOf(normaliseRank(a.rank)) - RANK_ORDER.indexOf(normaliseRank(b.rank)));
        skillsMainList.innerHTML = sorted.map(s => skillRowHTML(s, true)).join('');
        wireSkillLadderBtns();
    }

    function netRank(skills) {
        if (!skills?.length) return null;
        const verified = skills.filter(s => s.verified !== false);
        if (!verified.length) return null;
        for (const r of RANK_ORDER) if (verified.some(s => normaliseRank(s.rank) === r)) return r;
        return null;
    }

    function updateRankBadge() {
        if (!sheet) return;
        const r     = netRank(sheet.skills);
        const color = RANK_COLORS[r] || '#888';
        if (rankBadgeEl) {
            if (!r || r === 'F') { rankBadgeEl.classList.remove('visible'); }
            else {
                rankBadgeEl.textContent   = r;
                rankBadgeEl.style.color   = color;
                rankBadgeEl.style.borderColor   = color;
                rankBadgeEl.style.textShadow    = r === 'S+' ? `0 0 8px ${color}` : '';
                rankBadgeEl.classList.add('visible');
            }
        }
        if (statsPopupRankBadge) {
            if (!r) { statsPopupRankBadge.style.display = 'none'; }
            else {
                statsPopupRankBadge.textContent = r;
                statsPopupRankBadge.style.color       = color;
                statsPopupRankBadge.style.borderColor = color;
                statsPopupRankBadge.style.textShadow  = r === 'S+' ? `0 0 8px ${color}` : '';
                statsPopupRankBadge.style.display      = '';
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

    // ── Fetch stats ──────────────────────────────────────────────────────────
    async function fetchStats(forceRefresh) {
        if (classNameEl)    classNameEl.textContent    = 'Analyzing...';
        if (personalityEl)  personalityEl.textContent  = '—';
        if (personalityDesc) personalityDesc.textContent = '';
        if (bioEl)          bioEl.textContent          = '';
        if (skillsListEl)   skillsListEl.innerHTML     = '<div class="skill-loading">Scanning data...</div>';
        if (skillsMainList) skillsMainList.innerHTML   = '<div class="skill-loading">Scanning...</div>';
        try {
            const url = '/pug/api/stats' + (forceRefresh ? '?refresh=true' : '');
            const res = await fetch(url);
            if (!res.ok) throw new Error(res.status);
            sheet = (await res.json()).sheet;
            renderModal(); renderMainCard(); updateRankBadge();
        } catch {
            if (classNameEl)  classNameEl.textContent  = 'Error';
            if (skillsListEl) skillsListEl.innerHTML   = '<div class="skill-loading">Could not load — try again.</div>';
        }
    }

    // ── Midnight refresh ─────────────────────────────────────────────────────
    function scheduleMidnightRefresh() {
        const now = new Date(), next = new Date(now);
        next.setDate(now.getDate() + 1); next.setHours(0, 0, 5, 0);
        setTimeout(() => { fetchStats(true); scheduleMidnightRefresh(); }, next - now);
    }
    scheduleMidnightRefresh();

    // ── Page-load ────────────────────────────────────────────────────────────
    fetchBenchmarks();
    fetchExpConfig();
    fetch('/pug/api/stats?cache_only=true')
        .then(r => r.json())
        .then(data => { if (data.sheet) { sheet = data.sheet; renderMainCard(); updateRankBadge(); } })
        .catch(() => {});

    window.addEventListener('langChanged', () => { reapplyStatsLabels(); if (sheet) renderModal(); });
});
