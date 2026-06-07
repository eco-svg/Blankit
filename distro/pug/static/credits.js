(function () {
  'use strict';

  let _balance = 0;
  let _topupSelected = null;

  const TX_LABELS = {
    topup_request:    'Top-up requested',
    topup_paid:       'Top-up credited',
    spend:            'Spent',
    earn:             'Earned',
    sellback_request: 'Sell-back requested',
    sellback_paid:    'Sell-back processed',
    payout_request:   'Payout requested',
    payout_sent:      'Payout sent',
  };

  function fmt(n) { return n.toLocaleString(); }

  function setMsg(el, msg, isErr) {
    el.textContent = msg;
    el.className   = 'credits-msg' + (isErr ? ' credits-msg-err' : ' credits-msg-ok');
  }

  function renderTxList(txs) {
    const list = document.getElementById('creditsTxList');
    if (!list) return;
    if (!txs.length) {
      list.innerHTML = '<div class="credits-tx-empty">No transactions yet.</div>';
      return;
    }
    list.innerHTML = txs.map(t => {
      const sign    = t.amount >= 0 ? '+' : '';
      const cls     = t.amount >= 0 ? 'credits-tx-pos' : 'credits-tx-neg';
      const label   = TX_LABELS[t.tx_type] || t.tx_type;
      const date    = t.created_at ? new Date(t.created_at).toLocaleDateString() : '';
      const status  = t.status !== 'completed' ? `<span class="credits-tx-status credits-tx-status-${t.status}">${t.status}</span>` : '';
      return `<div class="credits-tx-row">
        <div class="credits-tx-info">
          <span class="credits-tx-label">${label}</span>
          ${status}
          <span class="credits-tx-date">${date}</span>
        </div>
        <span class="credits-tx-amt ${cls}">${sign}${fmt(Math.abs(t.amount))} VC</span>
      </div>`;
    }).join('');
  }

  function loadWallet() {
    fetch('/pug/api/wallet')
      .then(r => r.json())
      .then(data => {
        _balance = data.balance || 0;
        const balEl = document.getElementById('creditsBalance');
        if (balEl) balEl.textContent = fmt(_balance);
        const hint = document.getElementById('sellbackBalanceHint');
        if (hint) hint.textContent = `Available: ${fmt(_balance)} VC`;
        renderTxList(data.transactions || []);
      })
      .catch(() => {});
  }

  // ── TopUp amount selector ──

  function updateTopupSelected(amount) {
    _topupSelected = amount;
    const row = document.getElementById('topupSelectedRow');
    const val = document.getElementById('topupSelectedVal');
    const btn = document.getElementById('topupSubmitBtn');
    if (amount && amount >= 100) {
      row.style.display = '';
      val.textContent   = fmt(amount);
      btn.disabled      = false;
    } else {
      row.style.display = 'none';
      btn.disabled      = true;
    }
  }

  function initTopup() {
    const grid   = document.getElementById('topupAmountGrid');
    const custom = document.getElementById('topupCustomAmt');
    const submit = document.getElementById('topupSubmitBtn');
    const msg    = document.getElementById('topupMsg');
    if (!grid) return;

    grid.querySelectorAll('.credits-amt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        grid.querySelectorAll('.credits-amt-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        custom.value = '';
        updateTopupSelected(parseInt(btn.dataset.amount, 10));
      });
    });

    custom.addEventListener('input', () => {
      grid.querySelectorAll('.credits-amt-btn').forEach(b => b.classList.remove('active'));
      const v = parseInt(custom.value, 10);
      updateTopupSelected(isNaN(v) ? null : v);
    });

    submit.addEventListener('click', () => {
      if (!_topupSelected || _topupSelected < 100) return;
      submit.disabled = true;
      msg.textContent = '';
      fetch('/pug/api/wallet/topup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ amount: _topupSelected }),
      })
        .then(r => r.json().then(d => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          if (ok) {
            setMsg(msg, d.message || 'Request submitted!', false);
            loadWallet();
          } else {
            setMsg(msg, d.error || 'Something went wrong', true);
            submit.disabled = false;
          }
        })
        .catch(() => { setMsg(msg, 'Network error', true); submit.disabled = false; });
    });
  }

  // ── SellBack ──

  function initSellback() {
    const input  = document.getElementById('sellbackAmt');
    const submit = document.getElementById('sellbackSubmitBtn');
    const msg    = document.getElementById('sellbackMsg');
    if (!input) return;

    input.addEventListener('input', () => {
      const v = parseInt(input.value, 10);
      submit.disabled = isNaN(v) || v < 100 || v > _balance;
    });

    submit.addEventListener('click', () => {
      const v = parseInt(input.value, 10);
      if (isNaN(v) || v < 100) return;
      submit.disabled = true;
      msg.textContent = '';
      fetch('/pug/api/wallet/sellback', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ amount: v }),
      })
        .then(r => r.json().then(d => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          if (ok) {
            setMsg(msg, d.message || 'Request submitted!', false);
            input.value = '';
            submit.disabled = true;
            loadWallet();
          } else {
            setMsg(msg, d.error || 'Something went wrong', true);
            submit.disabled = false;
          }
        })
        .catch(() => { setMsg(msg, 'Network error', true); submit.disabled = false; });
    });
  }

  function init() {
    const refreshBtn = document.getElementById('creditsRefreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', loadWallet);
    initTopup();
    initSellback();
    loadWallet();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // reload wallet when navigating to credits tab
  document.addEventListener('veyra:navigate', e => {
    if (e.detail && e.detail.route === 'credits') loadWallet();
  });
})();
