/* Skills: character sheet, ranks, suggestions, achievements + verification. */
(function () {
  'use strict';
  const { $, api, esc, toast, modal, closeModal, confirm } = window.Veyra;

  const RANK_COLORS = {
    'S+':'#ffd700','S':'#ffb700','S-':'#ffa500',
    'A+':'#ff7c4d','A':'#ff8c42','A-':'#e8854a',
    'B+':'#5a8fc8','B':'#4a7aaa','B-':'#4070a0',
    'C+':'#8ac888','C':'#78b878','C-':'#68a068',
    'D+':'#a0a0a0','D':'#888888','D-':'#707070',
    'E+':'#c87040','E':'#c06030','E-':'#a85028','F':'#803010',
  };
  let benchmarks = null;
  let sheet = null;

  function rankBadge(s) {
    const r = (s.rank || 'E').toUpperCase();
    const verified = s.verified !== false;
    const col = verified ? (RANK_COLORS[r] || '#888') : 'var(--text-3)';
    const label = verified ? r : '?';
    const title = verified ? `Rank ${r}` : 'Unverified — add proof to unlock rank';
    return `<span class="rank-badge" style="color:${col};border-color:${col}" title="${title}">${label}</span>`;
  }

  function renderSheet() {
    const s = sheet || {};
    $('#sheetClass').textContent       = s.class_official || 'Blank Slate';
    $('#sheetPersonality').textContent = s.personality ? `${s.personality} — ${s.personality_desc || ''}` : '';
    $('#sheetBio').textContent         = s.bio || 'No character data yet. Add goals, habits and achievements, then re-scan.';

    // skills
    const wrap = $('#skillList');
    wrap.innerHTML = '';
    const skills = (s.skills || []);
    if (!skills.length) wrap.innerHTML = '<div class="empty">No confirmed skills yet — confirm a suggestion or add one.</div>';
    skills.forEach(sk => {
      const exp = sk.exp || 0;
      const row = document.createElement('div');
      row.className = 'skill-row';
      row.innerHTML = `
        ${rankBadge(sk)}
        <div class="row-main">
          <span class="skill-name">${esc(sk.name)}</span>
          ${sk.class_label ? `<span class="skill-class">· ${esc(sk.class_label)}</span>` : ''}
          ${sk.context ? `<div class="skill-ctx">${esc(sk.context)}</div>` : ''}
          ${sk.note ? `<div class="skill-note">${esc(sk.note)}</div>` : ''}
          <div class="exp-bar" title="${exp} EXP"><div style="width:${Math.min(100, (exp / 200) * 100)}%"></div></div>
        </div>
        <div class="row-actions">
          <button class="icon-btn" title="Set class/category">⚙</button>
          <button class="icon-btn danger" title="Remove skill">✕</button>
        </div>`;
      const [classBtn, delBtn] = row.querySelectorAll('.row-actions .icon-btn');
      classBtn.onclick = () => openClassPicker(sk);
      delBtn.onclick = async () => {
        if (!await confirm({ title: 'Remove skill?', text: `"${sk.name}" will be removed from your sheet.`, okLabel: 'Remove', danger: true })) return;
        const d = await api('/pug/api/stats/skill', { method: 'DELETE',
          body: { name: sk.name, class_id: sk.class_id || '' } });
        sheet = d.sheet; renderSheet();
      };
      wrap.appendChild(row);
    });

    // suggestions
    const sw = $('#suggestionList');
    sw.innerHTML = '';
    const sugg = (s.suggestions || []);
    if (!sugg.length) sw.innerHTML = '<div class="empty">No new suggestions — re-scan after adding activity.</div>';
    sugg.forEach(sg => {
      const chip = document.createElement('span');
      chip.className = 'suggestion-chip';
      chip.innerHTML = `${esc(sg.name)}${sg.class_label ? ` <span class="muted">· ${esc(sg.class_label)}</span>` : ''}
        <button class="icon-btn" title="Confirm" style="color:var(--ok)">✓</button>
        <button class="icon-btn" title="Dismiss">✕</button>`;
      const [ok, no] = chip.querySelectorAll('button');
      ok.onclick = async () => {
        const d = await api('/pug/api/stats/skill', { method: 'POST',
          body: { name: sg.name, class_id: sg.class_id || '', class_label: sg.class_label || '' } });
        sheet = d.sheet; renderSheet(); refreshSkillTagPicker();
        toast('Skill confirmed — a matching habit was created');
      };
      no.onclick = async () => {
        const d = await api('/pug/api/stats/skill-suggestion/dismiss', { method: 'POST', body: { name: sg.name } });
        sheet = d.sheet; renderSheet();
      };
      sw.appendChild(chip);
    });
    refreshSkillTagPicker();
  }

  // expose confirmed skills to the community composer
  function refreshSkillTagPicker() {
    const sel = $('#postSkillTag');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">No skill tag</option>';
    ((sheet && sheet.skills) || []).forEach(sk => {
      const o = document.createElement('option');
      o.value = sk.name; o.textContent = sk.name;
      sel.appendChild(o);
    });
    sel.value = cur;
  }

  async function loadBenchmarks() {
    if (benchmarks) return benchmarks;
    try { benchmarks = await (await fetch('/pug_style/skill_benchmarks.json')).json(); }
    catch (_) { benchmarks = {}; }
    return benchmarks;
  }

  async function openClassPicker(sk) {
    await loadBenchmarks();
    const opts = Object.keys(benchmarks).map(k =>
      `<option value="${esc(k)}" ${sk.class_label === k ? 'selected' : ''}>${esc(k)}</option>`).join('');
    const m = modal(`
      <h3>Skill category</h3>
      <div class="modal-sub">Pick the benchmark class for <strong>${esc(sk.name)}</strong> so ranks compare against the right scale.</div>
      <select class="select" id="classSel">
        <option value="">— none —</option>${opts}
      </select>
      <div class="modal-actions">
        <button class="btn ghost" id="ccCancel">Cancel</button>
        <button class="btn" id="ccSave">Save</button>
      </div>`);
    $('#ccCancel', m).onclick = closeModal;
    $('#ccSave', m).onclick = async () => {
      const label = $('#classSel', m).value;
      await api('/pug/api/stats/skill-class', { method: 'PATCH',
        body: { name: sk.name, class_id: label ? label.toLowerCase().replace(/[^a-z0-9]+/g, '_') : '', class_label: label } });
      closeModal();
      loadSheet(false);
    };
  }

  function loadSheet(generate) {
    const qs = generate ? '' : '?cache_only=true';
    api('/pug/api/stats' + qs).then(d => { sheet = d.sheet; renderSheet(); }).catch(() => {});
  }

  $('#refreshSheetBtn').addEventListener('click', async () => {
    const btn = $('#refreshSheetBtn');
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Scanning…';
    try {
      const d = await api('/pug/api/stats?refresh=true');
      sheet = d.sheet; renderSheet();
      toast('Sheet re-scanned');
    } catch (e) { toast(e.message, 'error'); }
    btn.disabled = false; btn.textContent = 'Re-scan';
  });

  $('#addSkillBtn').addEventListener('click', async () => {
    const input = $('#newSkillInput');
    const name = input.value.trim();
    if (!name) return;
    try {
      const d = await api('/pug/api/stats/skill', { method: 'POST', body: { name } });
      sheet = d.sheet; input.value = ''; renderSheet();
      toast('Skill added (unverified)');
    } catch (e) { toast(e.message, 'error'); }
  });

  // ── achievements ───────────────────────────────────────────
  function loadAchievements() {
    api('/pug/api/achievements').then(items => {
      const wrap = $('#achList');
      wrap.innerHTML = '';
      if (!items.length) wrap.innerHTML = '<div class="empty">Nothing yet. Achievements are your evidence.</div>';
      items.forEach(a => {
        const row = document.createElement('div');
        row.className = 'row-item';
        const vtag = a.verified === 'link'
          ? `<span class="tag ok" title="${esc(a.vlink)}">verified · link</span>`
          : a.verified === 'media'
            ? '<span class="tag ok">verified · media</span>'
            : '<span class="tag warn">unverified</span>';
        row.innerHTML = `
          <div class="row-main">
            <div class="row-title">${esc(a.title)}</div>
            <div class="row-sub">${esc(a.desc || '')}</div>
          </div>
          ${vtag}
          <div class="row-actions">
            ${a.verified ? '' : '<button class="icon-btn" title="Verify">🛡</button>'}
            <button class="icon-btn danger" title="Delete">✕</button>
          </div>`;
        const verifyBtn = row.querySelector('.row-actions .icon-btn:not(.danger)');
        if (verifyBtn) verifyBtn.onclick = () => openVerify(a);
        row.querySelector('.row-actions .danger').onclick = async () => {
          if (!await confirm({ title: 'Delete achievement?', text: a.title, okLabel: 'Delete', danger: true })) return;
          await api(`/pug/api/achievements/${a.id}`, { method: 'DELETE' });
          loadAchievements();
        };
        wrap.appendChild(row);
      });
    }).catch(() => {});
  }

  $('#addAchBtn').addEventListener('click', async () => {
    const title = $('#achTitle').value.trim();
    if (!title) { toast('Give it a title', 'error'); return; }
    try {
      await api('/pug/api/achievements', { method: 'POST',
        body: { title, description: $('#achDesc').value.trim() } });
      $('#achTitle').value = ''; $('#achDesc').value = '';
      toast('Added — verify it to unlock a real rank');
      loadAchievements();
    } catch (e) { toast(e.message, 'error'); }
  });

  function openVerify(a) {
    const m = modal(`
      <h3>Verify work</h3>
      <div class="modal-sub">${esc(a.title)} — add a public link or upload media as proof.</div>
      <div class="seg mb-12" id="vSeg">
        <button class="active" data-t="link">Link</button>
        <button data-t="media">Upload media</button>
      </div>
      <div id="vLink">
        <input class="input" id="vLinkInput" type="url" placeholder="GitHub repo, Strava, YouTube, live demo…">
        <div class="muted mt-8" style="font-size:0.74rem">Any public URL that shows the work.</div>
      </div>
      <div id="vMedia" class="hidden">
        <input class="input" id="vMediaInput" type="file" accept="audio/*,video/*,image/*">
        <div class="muted mt-8" style="font-size:0.74rem">Screenshot, recording or export. Max 50 MB.</div>
      </div>
      <div class="form-error" id="vError"></div>
      <div class="modal-actions">
        <button class="btn ghost" id="vCancel">Cancel</button>
        <button class="btn" id="vSubmit">Submit proof</button>
      </div>`);
    let tab = 'link';
    m.querySelectorAll('#vSeg button').forEach(b => b.onclick = () => {
      tab = b.dataset.t;
      m.querySelectorAll('#vSeg button').forEach(x => x.classList.toggle('active', x === b));
      $('#vLink', m).classList.toggle('hidden', tab !== 'link');
      $('#vMedia', m).classList.toggle('hidden', tab !== 'media');
    });
    $('#vCancel', m).onclick = closeModal;
    $('#vSubmit', m).onclick = async () => {
      const errEl = $('#vError', m);
      try {
        if (tab === 'link') {
          const link = $('#vLinkInput', m).value.trim();
          if (!/^https?:\/\//.test(link)) { errEl.textContent = 'Enter a valid http/https URL.'; return; }
          await api(`/pug/api/achievements/${a.id}/verify`, { method: 'PATCH', body: { link } });
        } else {
          const f = $('#vMediaInput', m).files[0];
          if (!f) { errEl.textContent = 'Choose a file first.'; return; }
          const fd = new FormData();
          fd.append('media', f);
          await api(`/pug/api/achievements/${a.id}/verify`, { method: 'PATCH', body: fd });
        }
        closeModal();
        toast('Proof submitted — rank unlocks on next scan');
        loadAchievements();
      } catch (e) { errEl.textContent = e.message; }
    };
  }

  window.Veyra.when('skills', first => {
    loadSheet(first);   // first activation may generate; later ones read cache
    loadAchievements();
  });
  // community composer needs the tag list even if skills tab never opened
  window.Veyra.when('community', () => { if (!sheet) loadSheet(false); });
})();
