/* Eyes wallet: balance, rates, top-up / sell-back, history. */
(function () {
  'use strict';
  const { $, api, esc, toast, confirm, timeAgo } = window.Veyra;

  let rates = {};

  function quote() {
    const cur = $('#walletCurrency').value;
    const amt = parseInt($('#walletAmount').value, 10);
    const r = rates[cur];
    const q = $('#walletQuote');
    if (!r || !amt || amt <= 0) { q.textContent = r ? `Minimum ${r.min_topup} Eyes for ${cur}` : ''; return; }
    const pay = (amt * r.buy_rate).toFixed(2);
    const get = (amt * r.sell_rate).toFixed(2);
    q.textContent = `Top-up: pay ${r.symbol}${pay} · Sell-back: receive ${r.symbol}${get} (min ${r.min_topup} Eyes)`;
  }

  async function loadRates() {
    try {
      rates = await api('/pug/api/wallet/rates');
      const sel = $('#walletCurrency');
      const keep = sel.value;
      sel.innerHTML = '';
      const preferred = ['INR', 'USD', 'EUR', 'GBP'];
      const codes = Object.keys(rates).sort((a, b) => {
        const pa = preferred.indexOf(a), pb = preferred.indexOf(b);
        if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
        return a.localeCompare(b);
      });
      codes.forEach(c => {
        const o = document.createElement('option');
        o.value = c;
        o.textContent = `${c} ${rates[c].symbol || ''}`;
        sel.appendChild(o);
      });
      sel.value = keep && rates[keep] ? keep : (rates['INR'] ? 'INR' : 'USD');
      quote();
    } catch (_) {}
  }

  function txLabel(t) {
    const map = {
      topup_request: 'Top-up requested', topup_paid: 'Top-up credited',
      sellback_request: 'Sell-back requested', sellback_paid: 'Sell-back paid out',
      spend: 'Spent', earn: 'Earned',
    };
    return map[t.tx_type] || t.tx_type;
  }

  async function load() {
    try {
      const d = await api('/pug/api/wallet');
      $('#walletBalance').textContent = d.balance;
      const wrap = $('#txList');
      wrap.innerHTML = '';
      if (!d.transactions.length) wrap.innerHTML = '<div class="empty">No transactions yet.</div>';
      d.transactions.forEach(t => {
        const row = document.createElement('div');
        row.className = 'tx-row';
        const statusTag = t.status === 'pending' ? '<span class="tag warn">pending</span>'
          : t.status === 'completed' ? '<span class="tag ok">done</span>'
          : `<span class="tag">${esc(t.status)}</span>`;
        const cancellable = t.status === 'pending' &&
          ['topup_request', 'sellback_request'].includes(t.tx_type);
        row.innerHTML = `
          <div class="row-main">
            <div>${esc(txLabel(t))} ${t.ref_id ? `<span class="muted mono" style="font-size:0.7rem">${esc(t.ref_id)}</span>` : ''}</div>
            <div class="muted" style="font-size:0.7rem">${timeAgo(t.created_at)}</div>
          </div>
          <span class="tx-amt ${t.amount >= 0 ? 'pos' : 'neg'}">${t.amount >= 0 ? '+' : ''}${t.amount}</span>
          ${statusTag}
          ${cancellable ? '<button class="icon-btn danger" title="Cancel request">✕</button>' : ''}`;
        const cancelBtn = row.querySelector('.icon-btn');
        if (cancelBtn) cancelBtn.onclick = async () => {
          if (!await confirm({ title: 'Cancel request?', text: 'The pending request will be withdrawn.', okLabel: 'Cancel it', danger: true })) return;
          try { await api(`/pug/api/wallet/tx/${t.id}/cancel`, { method: 'POST' }); load(); }
          catch (e) { toast(e.message, 'error'); }
        };
        wrap.appendChild(row);
      });
    } catch (_) {}
  }

  async function submit(kind) {
    const errEl = $('#walletError');
    errEl.textContent = '';
    const amt = parseInt($('#walletAmount').value, 10);
    const cur = $('#walletCurrency').value;
    if (!amt || amt <= 0) { errEl.textContent = 'Enter an amount in Eyes.'; return; }
    try {
      const d = await api(`/pug/api/wallet/${kind}`, { method: 'POST', body: { amount: amt, currency: cur } });
      toast(d.message || 'Request received');
      $('#walletAmount').value = '';
      load();
    } catch (e) { errEl.textContent = e.message; }
  }

  $('#topupBtn').addEventListener('click', () => submit('topup'));
  $('#sellbackBtn').addEventListener('click', () => submit('sellback'));
  $('#walletCurrency').addEventListener('change', quote);
  $('#walletAmount').addEventListener('input', quote);

  window.Veyra.when('wallet', () => { load(); loadRates(); });
})();
