document.addEventListener('DOMContentLoaded', () => {

    const modal         = document.getElementById('statsModal');
    const btn           = document.getElementById('statsBtn');
    const closeBtn      = document.querySelector('#statsModal .close-modal');
    const classNameEl   = document.getElementById('statClassName');
    const bioEl         = document.getElementById('statBio');
    const skillsListEl  = document.getElementById('statSkillsList');
    const notesEl       = document.getElementById('stat-notes');
    const streakEl      = document.getElementById('stat-streak');
    const mediaEl       = document.getElementById('stat-media');
    const officialBtn   = document.getElementById('classModeOfficial');
    const playfulBtn    = document.getElementById('classModePlayful');
    const refreshBtn    = document.getElementById('refreshStatsBtn');

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

    btn.onclick = () => {
        modal.classList.remove('hidden');
        if (!sheet) fetchStats(false);
    };

    closeBtn.onclick = () => modal.classList.add('hidden');
    window.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

    officialBtn.addEventListener('click', () => {
        classMode = 'official';
        officialBtn.classList.add('active');
        playfulBtn.classList.remove('active');
        renderClass();
    });

    playfulBtn.addEventListener('click', () => {
        classMode = 'playful';
        playfulBtn.classList.add('active');
        officialBtn.classList.remove('active');
        renderClass();
    });

    refreshBtn.addEventListener('click', () => {
        if (!loading) fetchStats(true);
    });

    function renderClass() {
        if (!sheet) return;
        classNameEl.textContent = (classMode === 'official'
            ? sheet.class_official
            : sheet.class_playful) || '—';
    }

    function renderSkills(skills) {
        if (!skills || !skills.length) {
            skillsListEl.innerHTML = '<div class="skill-loading">No skill data yet.</div>';
            return;
        }
        skillsListEl.innerHTML = skills.map(s => {
            const rank  = (s.rank || 'C').toUpperCase();
            const color = RANK_COLORS[rank] || '#888';
            const glow  = rank === 'S+' ? `text-shadow:0 0 10px ${color};` : '';
            return `
                <div class="skill-row">
                    <span class="skill-name">${s.name || '—'}</span>
                    <span class="rank-badge" style="color:${color};${glow}">${rank}</span>
                </div>`;
        }).join('');
    }

    async function fetchStats(forceRefresh) {
        loading = true;
        refreshBtn.textContent = '...';

        classNameEl.textContent      = 'Analyzing...';
        bioEl.textContent            = '';
        skillsListEl.innerHTML       = '<div class="skill-loading">Scanning data...</div>';
        notesEl.textContent          = '--';
        streakEl.textContent         = '--';
        mediaEl.textContent          = '--';

        try {
            const res  = await fetch('/pug/api/stats' + (forceRefresh ? '?refresh=true' : ''));
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();

            notesEl.textContent  = data.notes_count ?? '--';
            streakEl.textContent = data.streak ? data.streak + ' 🔥' : '0';
            mediaEl.textContent  = data.media_count ?? '--';

            sheet = data.sheet;
            if (sheet) {
                renderClass();
                bioEl.textContent = sheet.bio || '';
                renderSkills(sheet.skills);
            } else {
                classNameEl.textContent = '—';
                bioEl.textContent       = '';
                skillsListEl.innerHTML  = '<div class="skill-loading">Not enough data yet — keep building.</div>';
            }
        } catch {
            classNameEl.textContent = 'Error';
            skillsListEl.innerHTML  = '<div class="skill-loading">Could not load — try again.</div>';
        } finally {
            loading = false;
            refreshBtn.textContent = '↺';
        }
    }

});
