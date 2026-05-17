document.addEventListener('DOMContentLoaded', () => {

    const modal        = document.getElementById('statsModal');
    const btn          = document.getElementById('statsBtn');
    const btn2         = document.getElementById('statsBtn2');   // "analyze" on skills card
    const closeBtn     = document.querySelector('#statsModal .close-modal');
    const classNameEl  = document.getElementById('statClassName');
    const bioEl        = document.getElementById('statBio');
    const skillsListEl = document.getElementById('statSkillsList');
    const officialBtn  = document.getElementById('classModeOfficial');
    const playfulBtn   = document.getElementById('classModePlayful');
    const refreshBtn   = document.getElementById('refreshStatsBtn');

    // Main screen skills card
    const skillsMainList = document.getElementById('skillsMainList');

    let sheet     = null;
    let classMode = 'official';
    let loading   = false;

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

    // ── Modal open/close ─────────────────────────────────────────────────────
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

    refreshBtn?.addEventListener('click', () => {
        if (!loading) fetchStats(true);
    });

    // ── Render helpers ───────────────────────────────────────────────────────
    function renderClass() {
        if (!sheet || !classNameEl) return;
        classNameEl.textContent = (classMode === 'official'
            ? sheet.class_official
            : sheet.class_playful) || '—';
    }

    function skillRowHTML(s, large) {
        const rank  = (s.rank || 'C').toUpperCase();
        const color = RANK_COLORS[rank] || '#888';
        const glow  = rank === 'S+' ? `text-shadow:0 0 10px ${color};` : '';
        const size  = large ? '' : '';
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

    function renderModal() {
        if (!sheet) return;
        renderClass();
        if (bioEl) bioEl.textContent = sheet.bio || '';
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

    // ── Fetch stats ──────────────────────────────────────────────────────────
    async function fetchStats(forceRefresh) {
        loading = true;
        if (refreshBtn) refreshBtn.textContent = '...';

        if (classNameEl) classNameEl.textContent = 'Analyzing...';
        if (bioEl)        bioEl.textContent       = '';
        if (skillsListEl) skillsListEl.innerHTML  = '<div class="skill-loading">Scanning data...</div>';
        if (skillsMainList) skillsMainList.innerHTML = '<div class="skill-loading">Scanning...</div>';

        try {
            const url = '/pug/api/stats' + (forceRefresh ? '?refresh=true' : '');
            const res  = await fetch(url);
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();

            sheet = data.sheet;
            renderModal();
            renderMainCard();
        } catch {
            if (classNameEl) classNameEl.textContent = 'Error';
            if (skillsListEl) skillsListEl.innerHTML = '<div class="skill-loading">Could not load — try again.</div>';
        } finally {
            loading = false;
            if (refreshBtn) refreshBtn.textContent = '↺';
        }
    }

    // On page load: grab cached sheet silently (no generation)
    fetch('/pug/api/stats?cache_only=true')
        .then(r => r.json())
        .then(data => {
            if (data.sheet) {
                sheet = data.sheet;
                renderMainCard();
            }
        })
        .catch(() => {});

});
