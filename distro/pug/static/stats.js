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

    // ── Class selection (localStorage until backend persists it) ─────────────
    function _classKey(skillName) { return `veyra_sc_${skillName}`; }

    function getSavedClass(skillName) {
        try { return JSON.parse(localStorage.getItem(_classKey(skillName))); } catch { return null; }
    }

    function saveClass(skillName, classId, classLabel) {
        try { localStorage.setItem(_classKey(skillName), JSON.stringify({ id: classId, label: classLabel })); } catch {}
        _applyClassTag(skillName, classLabel);
    }

    function _applyClassTag(skillName, classLabel) {
        if (!skillsMainList) return;
        const row = skillsMainList.querySelector(`.skill-row-prog[data-skill="${CSS.escape(skillName)}"]`);
        if (!row) return;
        let tag = row.querySelector('.skill-class-tag');
        if (!tag) {
            const nameEl = row.querySelector('.skill-name');
            if (!nameEl) return;
            tag = document.createElement('span');
            tag.className = 'skill-class-tag';
            nameEl.insertAdjacentElement('afterend', tag);
        }
        tag.textContent = `· ${classLabel}`;
    }

    function fmtExp(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 1000)    return Math.round(n / 1000) + 'K';
        return String(n);
    }

    function computeExpRank(exp) {
        if (!expConfig) return 'F';
        const th = expConfig.rank_thresholds;
        for (const r of RANK_ORDER) {
            if (th[r] != null && exp >= th[r]) return r;
        }
        return 'F';
    }

    function expTierProgress(exp) {
        if (!expConfig) return { pct: 0, xpInTier: 0, tierSize: 200 };
        const rank  = computeExpRank(exp);
        const th    = expConfig.rank_thresholds;
        const idx   = RANK_ORDER.indexOf(rank);
        const tierStart = th[rank] ?? 0;
        const nextRank  = idx > 0 ? RANK_ORDER[idx - 1] : null;
        const tierEnd   = (nextRank && th[nextRank] != null) ? th[nextRank] : tierStart + 1;
        const tierSize  = Math.max(1, tierEnd - tierStart);
        const xpInTier  = exp - tierStart;
        const pct       = Math.min(99, Math.round((xpInTier / tierSize) * 100));
        return { pct, xpInTier, tierSize };
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
        const classTag = s.class_label ? `<span class="skill-class-tag">· ${s.class_label}</span>` : '';
        const bm       = getBenchmark(s.name);
        const isExp    = bm?.type === 'exp';

        // EXP skills: always show computed rank, never "?"
        let badgeHtml;
        if (isExp) {
            const expRank  = computeExpRank(s.exp || 0);
            const expColor = RANK_COLORS[expRank] || '#888';
            badgeHtml = `<span class="rank-badge" style="color:${expColor};">${expRank}</span>`;
        } else {
            badgeHtml = verified
                ? `<span class="rank-badge" style="color:${color};${glow}">${rank}</span>`
                : `<span class="rank-badge rank-unverified" title="Verify an achievement to unlock rank">?</span>`;
        }

        if (!withProgression) return `
            <div class="skill-row">
                <span class="skill-name-wrap"><span class="skill-name">${s.name||'—'}</span>${classTag}${context}${note}</span>
                ${badgeHtml}
            </div>`;

        let progressBar = '', nextLine = '', expandBtn = '';

        if (bm) {
            if (isExp) {
                const exp      = s.exp || 0;
                const expRank  = computeExpRank(exp);
                const expColor = RANK_COLORS[expRank] || '#888';
                const { pct, xpInTier, tierSize } = expTierProgress(exp);
                progressBar = `
                <div class="skill-progress-track">
                    <div class="skill-progress-fill" style="width:${pct}%;background:${expColor};opacity:0.85;"></div>
                </div>`;
                nextLine = `<div class="skill-next skill-exp-hint">${fmtExp(xpInTier)} / ${fmtExp(tierSize)} XP</div>`;
                expandBtn = `<button class="skill-ladder-btn" data-skill="${s.name}" data-bm-type="exp" data-class-id="${s.class_id||''}" title="Show classes">···</button>`;
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
                <span class="skill-name-wrap"><span class="skill-name">${s.name||'—'}</span>${classTag}${context}${note}</span>
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

    // ── EXP ladder HTML (class picker / info) ───────────────────────────────
    function expLadderHTML(bm, activeClassId) {
        const chips = (bm.classes || []).map(c => {
            const active = c.id === activeClassId;
            return `<span class="exp-class-chip${active ? ' active' : ''}" data-class-id="${c.id}" data-class-label="${c.label}">${c.label}</span>`;
        }).join('');

        const savedLabel = getSavedClass(activeClassId ? bm?.classes?.find(c => c.id === activeClassId)?.label || '' : '')?.label || '';
        const lockNote = activeClassId
            ? `<span class="exp-lock-note" style="opacity:0.45;font-size:0.68rem;">Class locked: ${bm?.classes?.find(c=>c.id===activeClassId)?.label||activeClassId}</span>`
            : `<span class="exp-lock-note" style="opacity:0.45;font-size:0.68rem;">Tap a class to select it — one-time per skill entry.</span>`;

        return `
        <div class="skill-ladder skill-ladder-exp">
            <div class="exp-ladder-classes">${chips}</div>
            ${lockNote}
            <div class="exp-ladder-msg" style="margin-top:8px;">
                <span style="opacity:0.5;font-size:0.72rem;">EXP from: likes · comments · shares · saves · DMs · collabs · hires</span>
                <br><span style="opacity:0.35;font-size:0.65rem;">Retroactive — every post counts from day one.</span>
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

                // Use saved class if set
                const saved = getSavedClass(skillName);
                const activeClassId = saved?.id || '';

                const rankEl = row.querySelector('.rank-badge');
                const rank   = rankEl?.textContent?.trim() === '?' ? 'F' : (rankEl?.textContent?.trim() || 'F');
                const html   = bm.type === 'exp'
                    ? expLadderHTML(bm, activeClassId)
                    : metricLadderHTML(skillName, rank, bm);

                row.insertAdjacentHTML('beforeend', html);
                btn.textContent = '✕';

                // ── Wire metric class tabs ─────────────────────────────────
                row.querySelectorAll('.ladder-class-tab').forEach(tab => {
                    tab.addEventListener('click', () => {
                        const idx = +tab.dataset.clsIdx;
                        row.querySelectorAll('.ladder-class-tab').forEach(t => t.classList.toggle('active', +t.dataset.clsIdx === idx));
                        row.querySelectorAll('.ladder-class-block').forEach(b => b.classList.toggle('hidden', +b.dataset.clsIdx !== idx));
                        const cls = bm.classes[idx];
                        if (cls) {
                            const noteEl = row.querySelector('.ladder-note');
                            if (noteEl) noteEl.textContent = cls.note || '';
                            saveClass(skillName, cls.id, cls.label);
                        }
                    });
                });

                // ── Wire EXP class chips ───────────────────────────────────
                row.querySelectorAll('.exp-class-chip').forEach(chip => {
                    chip.addEventListener('click', () => {
                        row.querySelectorAll('.exp-class-chip').forEach(c => c.classList.remove('active'));
                        chip.classList.add('active');
                        saveClass(skillName, chip.dataset.classId, chip.dataset.classLabel);
                        // Update lock note text
                        const lockEl = row.querySelector('.exp-lock-note');
                        if (lockEl) lockEl.textContent = `Class locked: ${chip.dataset.classLabel}`;
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
        // Apply any previously saved class selections
        sorted.forEach(s => {
            const saved = getSavedClass(s.name);
            if (saved?.label) _applyClassTag(s.name, saved.label);
        });
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
