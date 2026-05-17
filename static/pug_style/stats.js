document.addEventListener('DOMContentLoaded', () => {

    const modal           = document.getElementById('statsModal');
    const btn             = document.getElementById('statsBtn');
    const btn2            = document.getElementById('statsBtn2');
    const closeBtn        = document.querySelector('#statsModal .close-modal');
    const classNameEl     = document.getElementById('statClassName');
    const personalityEl   = document.getElementById('statPersonality');
    const personalityDesc = document.getElementById('statPersonalityDesc');
    const bioEl           = document.getElementById('statBio');
    const skillsListEl    = document.getElementById('statSkillsList');
    const officialBtn     = document.getElementById('classModeOfficial');
    const playfulBtn      = document.getElementById('classModePlayful');
    const rankBadgeEl     = document.getElementById('headerRankBadge');

    const skillsMainList  = document.getElementById('skillsMainList');

    let sheet     = null;
    let classMode = 'official';

    const RANK_COLORS = {
        'S+': '#ffd700',
        'S':  '#ffb700',
        'A':  '#ff8c42',
        'B':  '#4a7aaa',
        'C':  '#78b878',
        'D':  '#888888',
        'E':  '#c85a2a',
        'F':  '#c85a2a',
    };

    // ── Modal open/close ────────────────────────────────────────────────────
    btn?.addEventListener('click', () => {
        modal.classList.remove('hidden');
        if (!sheet) fetchStats(false);
    });

    btn2?.addEventListener('click', () => {
        modal.classList.remove('hidden');
        if (!sheet) fetchStats(false);
        else renderModal();
    });

    closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));
    window.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

    officialBtn?.addEventListener('click', () => {
        classMode = 'official';
        officialBtn.classList.add('active');
        playfulBtn.classList.remove('active');
        renderClass();
    });

    playfulBtn?.addEventListener('click', () => {
        classMode = 'playful';
        playfulBtn.classList.add('active');
        officialBtn.classList.remove('active');
        renderClass();
    });

    // ── Render helpers ──────────────────────────────────────────────────────
    function renderClass() {
        if (!sheet || !classNameEl) return;
        classNameEl.textContent = (classMode === 'official'
            ? sheet.class_official
            : sheet.class_playful) || '—';
    }

    function skillRowHTML(s) {
        const rank  = (s.rank || 'C').toUpperCase();
        const color = RANK_COLORS[rank] || '#888';
        const glow  = rank === 'S+' ? `text-shadow:0 0 10px ${color};` : '';
        return `
            <div class="skill-row">
                <span class="skill-name">${s.name || '—'}</span>
                <span class="rank-badge" style="color:${color};${glow}">${rank}</span>
            </div>`;
    }

    function renderSkills(skills, container) {
        if (!container) return;
        if (!skills || !skills.length) {
            container.innerHTML = '<div class="skill-loading">No skill data yet.</div>';
            return;
        }
        container.innerHTML = skills.map(s => skillRowHTML(s)).join('');
    }

    function netRank(skills) {
        if (!skills || !skills.length) return null;
        const order = ['S+','S','A','B','C','D','E','F'];
        for (const r of order) {
            if (skills.some(s => (s.rank || '').toUpperCase() === r)) return r;
        }
        return null;
    }

    function updateRankBadge() {
        if (!rankBadgeEl || !sheet) return;
        const r = netRank(sheet.skills);
        if (!r) { rankBadgeEl.classList.remove('visible'); return; }
        const color = RANK_COLORS[r] || '#888';
        rankBadgeEl.textContent = r;
        rankBadgeEl.style.color = color;
        rankBadgeEl.style.borderColor = color;
        if (r === 'S+') rankBadgeEl.style.textShadow = `0 0 8px ${color}`;
        else rankBadgeEl.style.textShadow = '';
        rankBadgeEl.classList.add('visible');
    }

    function renderModal() {
        if (!sheet) return;
        renderClass();
        if (personalityEl)   personalityEl.textContent   = sheet.personality      || '—';
        if (personalityDesc) personalityDesc.textContent = sheet.personality_desc || '';
        if (bioEl)           bioEl.textContent           = sheet.bio || '';
        renderSkills(sheet.skills, skillsListEl);
    }

    function renderMainCard() {
        if (!skillsMainList) return;
        if (!sheet || !sheet.skills?.length) {
            skillsMainList.innerHTML = '<div class="skill-loading" style="margin-top:30px;">Click <strong>analyze</strong> or open STATS to detect your skills.</div>';
            return;
        }
        skillsMainList.innerHTML = sheet.skills.map(s => skillRowHTML(s)).join('');
    }

    // ── Fetch stats ─────────────────────────────────────────────────────────
    async function fetchStats(forceRefresh) {
        if (classNameEl)    classNameEl.textContent    = 'Analyzing...';
        if (personalityEl)  personalityEl.textContent  = '—';
        if (personalityDesc) personalityDesc.textContent = '';
        if (bioEl)          bioEl.textContent          = '';
        if (skillsListEl)   skillsListEl.innerHTML     = '<div class="skill-loading">Scanning data...</div>';
        if (skillsMainList) skillsMainList.innerHTML   = '<div class="skill-loading">Scanning...</div>';

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
        next.setHours(0, 0, 5, 0); // 00:00:05 next day
        const ms = next - now;
        setTimeout(() => {
            fetchStats(true);
            scheduleMidnightRefresh();
        }, ms);
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

});
