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
    const skillSuggestionsArea = document.getElementById('skillSuggestionsArea');
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

    // ── Add skill manually (two-step) ────────────────────────────────────────
    const addSkillBtn     = document.getElementById('addSkillBtn');
    const skillAdder      = document.getElementById('skillAdder');
    const skillAdderInput = document.getElementById('skillAdderInput');
    const skillAdderRes   = document.getElementById('skillAdderResults');

    addSkillBtn?.addEventListener('click', e => {
        e.stopPropagation();
        skillAdder?.classList.toggle('hidden');
        if (!skillAdder?.classList.contains('hidden')) skillAdderInput?.focus();
    });

    skillAdderInput?.addEventListener('input', () => {
        const q = (skillAdderInput.value || '').toLowerCase().trim();
        if (!skillAdderRes) return;
        if (!q || !benchmarks) { skillAdderRes.innerHTML = ''; return; }
        const matches = Object.keys(benchmarks).filter(k => k.toLowerCase().includes(q)).slice(0, 7);
        if (!matches.length) {
            skillAdderRes.innerHTML = '<div class="skill-adder-nomatch">Not in the database yet.<br><span>You can request it from the <strong>Requests</strong> tab.</span></div>';
            return;
        }
        skillAdderRes.innerHTML = matches.map(k =>
            `<div class="skill-add-row" data-skill="${k}">
                <div class="skill-add-row-header">
                    <span class="skill-add-name">${k}</span>
                    <span class="skill-add-arrow">›</span>
                </div>
                <div class="skill-add-class-picker hidden"></div>
            </div>`
        ).join('');
        skillAdderRes.querySelectorAll('.skill-add-row').forEach(row => {
            row.querySelector('.skill-add-row-header')?.addEventListener('click', () => {
                // Collapse any other open row
                skillAdderRes.querySelectorAll('.skill-add-row.open').forEach(r => {
                    if (r !== row) {
                        r.classList.remove('open');
                        r.querySelector('.skill-add-class-picker')?.classList.add('hidden');
                    }
                });
                const skillName = row.dataset.skill;
                const bm        = benchmarks[skillName];
                const picker    = row.querySelector('.skill-add-class-picker');
                if (!picker) return;
                // Toggle
                if (row.classList.contains('open')) {
                    row.classList.remove('open');
                    picker.classList.add('hidden');
                    return;
                }
                row.classList.add('open');
                picker.classList.remove('hidden');
                const classes   = bm?.classes || [];
                const isUnranked = bm?.type === 'unranked';
                const noProgressNotice = isUnranked
                    ? `<div class="skill-add-noprog">No progression system yet — <a class="skill-add-noprog-link" href="#requests">request one from the Requests tab</a>.</div>`
                    : '';
                if (!isUnranked && classes.length === 0) {
                    addSkillManual(skillName, '', '');
                    return;
                }
                if (!isUnranked && classes.length === 1) {
                    // Auto-add; skip class tag if label is same as skill name
                    const c = classes[0];
                    const sameAsSkill = c.label.toLowerCase().replace(/\W/g,'').includes(skillName.toLowerCase().replace(/\W/g,''));
                    addSkillManual(skillName, sameAsSkill ? '' : c.id, sameAsSkill ? '' : c.label);
                    return;
                }
                if (classes.length === 0) {
                    // Unranked + no classes: show notice + simple add button
                    picker.innerHTML = `${noProgressNotice}<button class="skill-add-confirm">Add anyway</button>`;
                    picker.querySelector('.skill-add-confirm')?.addEventListener('click', () => {
                        addSkillManual(skillName, '', '');
                    });
                    return;
                }
                const opts = classes.map(c => `<option value="${c.id}" data-label="${c.label}">${c.label}</option>`).join('');
                picker.innerHTML = `
                    ${noProgressNotice}
                    <select class="skill-add-select">
                        <option value="">Select class…</option>
                        ${opts}
                    </select>
                    <button class="skill-add-confirm">Add</button>`;
                picker.querySelector('.skill-add-confirm')?.addEventListener('click', () => {
                    const sel      = picker.querySelector('.skill-add-select');
                    const classId  = sel?.value || '';
                    const classLabel = sel?.options[sel.selectedIndex]?.dataset.label || '';
                    if (classes.length > 0 && !isUnranked && !classId) return;
                    addSkillManual(skillName, classId, classLabel);
                });
            });
        });
    });

    async function addSkillManual(name, classId, classLabel) {
        try {
            const res = await fetch('/pug/api/stats/skill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, class_id: classId, class_label: classLabel })
            });
            const data = await res.json();
            if (data.sheet) { sheet = data.sheet; renderMainCard(); updateRankBadge(); }
            if (classId) saveClass(name, classId, classLabel);
        } catch {}
        skillAdder?.classList.add('hidden');
        if (skillAdderInput) skillAdderInput.value = '';
        if (skillAdderRes)   skillAdderRes.innerHTML = '';
    }

    // ── Suggestions ──────────────────────────────────────────────────────────
    function renderSuggestions(suggestions) {
        if (!skillSuggestionsArea) return;
        if (!suggestions?.length) { skillSuggestionsArea.innerHTML = ''; return; }
        skillSuggestionsArea.innerHTML = `
            <div class="skill-suggestions-header">Detected Activity</div>
            ${suggestions.map(s => `
                <div class="skill-suggestion-row">
                    <span class="skill-suggestion-name">${s.name}${s.class_label ? `<span class="skill-class-tag">· ${s.class_label}</span>` : ''}</span>
                    <div class="skill-suggestion-actions">
                        <button class="skill-suggestion-track" data-skill="${s.name}" data-cid="${s.class_id||''}" data-clabel="${s.class_label||''}">Track</button>
                        <button class="skill-suggestion-dismiss" data-skill="${s.name}" title="Dismiss">×</button>
                    </div>
                </div>`
            ).join('')}`;
        skillSuggestionsArea.querySelectorAll('.skill-suggestion-track').forEach(btn => {
            btn.addEventListener('click', () =>
                addSkillManual(btn.dataset.skill, btn.dataset.cid, btn.dataset.clabel)
            );
        });
        skillSuggestionsArea.querySelectorAll('.skill-suggestion-dismiss').forEach(btn => {
            btn.addEventListener('click', () => dismissSuggestion(btn.dataset.skill));
        });
    }

    async function removeSkill(name, classId) {
        try {
            const res = await fetch('/pug/api/stats/skill', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, class_id: classId })
            });
            const data = await res.json();
            if (data.sheet) {
                sheet = data.sheet;
                try { localStorage.removeItem(_classKey(name)); } catch {}
                renderMainCard();
                updateRankBadge();
            }
        } catch {}
    }

    function wireRemoveBtns() {
        if (!skillsMainList) return;
        skillsMainList.querySelectorAll('.skill-remove-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                removeSkill(btn.dataset.skill, btn.dataset.cid);
            });
        });
    }

    async function dismissSuggestion(name) {
        try {
            const res = await fetch('/pug/api/stats/skill-suggestion/dismiss', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const data = await res.json();
            if (data.sheet) { sheet = data.sheet; renderSuggestions(sheet.suggestions || []); }
        } catch {}
    }

    // ── Class selection (localStorage + backend) ─────────────────────────────
    function _classKey(skillName) { return `veyra_sc_${skillName}`; }

    function getSavedClass(skillName) {
        try { return JSON.parse(localStorage.getItem(_classKey(skillName))); } catch { return null; }
    }

    function saveClass(skillName, classId, classLabel) {
        try { localStorage.setItem(_classKey(skillName), JSON.stringify({ id: classId, label: classLabel })); } catch {}
        // Update in-memory sheet
        if (sheet?.skills) {
            const sk = sheet.skills.find(s => s.name === skillName);
            if (sk) { sk.class_id = classId; sk.class_label = classLabel; }
        }
        // Persist to backend
        fetch('/pug/api/stats/skill-class', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: skillName, class_id: classId, class_label: classLabel })
        }).catch(() => {});
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
        const hasClass = !!(s.class_id || s.class_label);

        let badgeHtml;
        if (isExp) {
            const expRank  = computeExpRank(s.exp || 0);
            const expColor = RANK_COLORS[expRank] || '#888';
            badgeHtml = `<span class="rank-badge" style="color:${expColor};">${expRank}</span>`;
        } else if (verified) {
            badgeHtml = `<span class="rank-badge" style="color:${color};${glow}">${rank}</span>`;
        } else {
            badgeHtml = `<span class="rank-badge rank-unverified" style="color:${color};opacity:0.45;" title="Unverified — add proof to confirm rank">${rank}</span>`;
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
                progressBar = `<div class="skill-progress-track"><div class="skill-progress-fill" style="width:${pct}%;background:${expColor};opacity:0.85;"></div></div>`;
                nextLine = `<div class="skill-next skill-exp-hint">${fmtExp(xpInTier)} / ${fmtExp(tierSize)} XP</div>`;
                if (!hasClass && bm.classes?.length > 0) {
                    expandBtn = `<button class="skill-ladder-btn" data-skill="${s.name}" data-bm-type="exp" data-class-id="${s.class_id||''}" title="Choose class">···</button>`;
                }
            } else {
                const lockedCls = hasClass
                    ? (bm.classes?.find(c => c.id === s.class_id) || bm.classes?.[0])
                    : bm.classes?.[0];
                const cls = lockedCls;
                if (cls && verified) {
                    const pct  = Math.round(rankProgress(cls, rank) * 100);
                    const next = nextRankInClass(cls, rank);
                    progressBar = `<div class="skill-progress-track"><div class="skill-progress-fill" style="width:${pct}%;background:${color};box-shadow:0 0 6px ${color}33;"></div></div>`;
                    if (next && rank !== 'S+') {
                        nextLine = `<div class="skill-next">next <span class="skill-next-rank" style="color:${RANK_COLORS[next.rank]||'#aaa'}">${next.rank}</span> — ${next.label}${next.threshold ? ` <span class="skill-threshold">(${next.threshold})</span>` : ''}</div>`;
                    } else if (rank === 'S+') {
                        nextLine = `<div class="skill-next skill-maxed">peak rank achieved</div>`;
                    }
                } else if (!verified) {
                    progressBar = `<div class="skill-progress-track"><div class="skill-progress-fill" style="width:8%;background:${color}44;"></div></div>`;
                    nextLine = `<div class="skill-next skill-unverified-hint">${s.note || 'Add proof in Achievements to unlock rank'}</div>`;
                }
                if (!hasClass) {
                    expandBtn = `<button class="skill-ladder-btn" data-skill="${s.name}" data-bm-type="metric" title="Show rank ladder">···</button>`;
                }
            }
        }

        // Layout: rank badge lives at the right end of the progress bar row
        const removeBtn = `<button class="skill-remove-btn" data-skill="${s.name}" data-cid="${s.class_id||''}" title="Remove skill">×</button>`;
        const nameRow = `
            <div class="skill-row-main">
                <span class="skill-name-wrap"><span class="skill-name">${s.name||'—'}</span>${classTag}${context}${note}</span>
                <div class="skill-row-right">${expandBtn}${removeBtn}</div>
            </div>`;

        const barRow = bm
            ? `<div class="skill-bar-row">${progressBar || '<div class="skill-progress-track"><div class="skill-progress-fill" style="width:0%"></div></div>'}${badgeHtml}</div>`
            : `<div class="skill-row-main" style="margin-top:2px;"><span></span><div class="skill-row-right">${badgeHtml}</div></div>`;

        return `
        <div class="skill-row skill-row-prog" data-skill="${s.name}">
            ${nameRow}
            ${barRow}
            ${nextLine}
        </div>`;
    }

    // ── Ladder HTML (metric) ─────────────────────────────────────────────────
    function metricLadderHTML(skillName, currentRank, bm) {
        const rank    = normaliseRank(currentRank);
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
    function expLadderHTML(bm, activeClassId) {
        const chips = (bm.classes || []).map(c => {
            const active = c.id === activeClassId;
            return `<span class="exp-class-chip${active ? ' active' : ''}" data-class-id="${c.id}" data-class-label="${c.label}">${c.label}</span>`;
        }).join('');

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

                const saved = getSavedClass(skillName);
                const activeClassId = saved?.id || '';

                const rankEl = row.querySelector('.rank-badge');
                const rank   = rankEl?.textContent?.trim() || 'F';
                const html   = bm.type === 'exp'
                    ? expLadderHTML(bm, activeClassId)
                    : metricLadderHTML(skillName, rank, bm);

                row.insertAdjacentHTML('beforeend', html);
                btn.textContent = '✕';

                // Wire metric class tabs
                if (saved) {
                    row.querySelectorAll('.ladder-class-tab').forEach(t => {
                        t.style.cursor = 'default';
                        t.title = `Class locked: ${saved.label}`;
                    });
                } else {
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
                                row.querySelectorAll('.ladder-class-tab').forEach(t => {
                                    t.style.cursor = 'default';
                                    t.title = `Class locked: ${cls.label}`;
                                    t.replaceWith(t.cloneNode(true));
                                });
                                const lockEl = row.querySelector('.ladder-lock-note');
                                if (lockEl) lockEl.textContent = `Locked: ${cls.label}`;
                            }
                        });
                    });
                }

                // Wire EXP class chips
                if (saved) {
                    row.querySelectorAll('.exp-class-chip').forEach(c => {
                        c.style.cursor = 'default';
                        c.style.pointerEvents = 'none';
                    });
                } else {
                    row.querySelectorAll('.exp-class-chip').forEach(chip => {
                        chip.addEventListener('click', () => {
                            row.querySelectorAll('.exp-class-chip').forEach(c => {
                                c.classList.remove('active');
                                c.style.cursor = 'default';
                                c.style.pointerEvents = 'none';
                            });
                            chip.classList.add('active');
                            saveClass(skillName, chip.dataset.classId, chip.dataset.classLabel);
                            const lockEl = row.querySelector('.exp-lock-note');
                            if (lockEl) lockEl.textContent = `Locked: ${chip.dataset.classLabel}`;
                        });
                    });
                }
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
            renderSuggestions(sheet?.suggestions || []);
            return;
        }
        const sorted = [...sheet.skills].sort((a, b) =>
            RANK_ORDER.indexOf(normaliseRank(a.rank)) - RANK_ORDER.indexOf(normaliseRank(b.rank)));
        // Merge localStorage class into each skill before rendering
        sorted.forEach(s => {
            const saved = getSavedClass(s.name);
            if (saved?.id)    s.class_id    = saved.id;
            if (saved?.label) s.class_label = saved.label;
        });
        skillsMainList.innerHTML = sorted.map(s => skillRowHTML(s, true)).join('');
        wireSkillLadderBtns();
        wireRemoveBtns();
        renderSuggestions(sheet.suggestions || []);
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
