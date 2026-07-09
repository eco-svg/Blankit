/**
 * credits.js — Eyes wallet ('Credits') tab — balance, top-up, sell-back, transaction history, FX rates.
 */

(function () {
  'use strict';

  let _balance      = 0;
  let _topupSelected = null;
  let _rates        = {};   // { 'INR': { buy_rate, sell_rate, min_topup, symbol }, ... }
  let _currency     = 'USD';
  let _razorpay     = { enabled: false, key_id: null };   // instant online pay (INR); from /wallet

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

  // browser locale → ISO 4217 currency code
  const COUNTRY_CURRENCY = {
    'IN':'INR','PK':'PKR','BD':'BDT','NP':'NPR','LK':'LKR','MM':'MMK',
    'US':'USD','CA':'CAD','GB':'GBP','AU':'AUD','NZ':'NZD',
    'DE':'EUR','FR':'EUR','IT':'EUR','ES':'EUR','PT':'EUR','NL':'EUR',
    'BE':'EUR','AT':'EUR','IE':'EUR','FI':'EUR','GR':'EUR','LU':'EUR',
    'JP':'JPY','CN':'CNY','SG':'SGD','HK':'HKD','KR':'KRW','TW':'TWD',
    'CH':'CHF','SE':'SEK','NO':'NOK','DK':'DKK','PL':'PLN','CZ':'CZK',
    'HU':'HUF','RO':'RON','BG':'BGN','RU':'RUB','UA':'UAH','TR':'TRY',
    'MX':'MXN','BR':'BRL','AR':'ARS','CO':'COP','PE':'PEN',
    'ID':'IDR','MY':'MYR','PH':'PHP','TH':'THB','VN':'VND',
    'NG':'NGN','KE':'KES','ZA':'ZAR','EG':'EGP','GH':'GHS','TZ':'TZS',
    'AE':'AED','SA':'SAR','QA':'QAR','IL':'ILS','KZ':'KZT',
  };

  // timezone → ISO 4217: more reliable than language tag
  const TZ_CURRENCY = {
    'Asia/Kolkata':'INR','Asia/Calcutta':'INR',
    'Asia/Karachi':'PKR',
    'Asia/Dhaka':'BDT',
    'Asia/Kathmandu':'NPR',
    'Asia/Colombo':'LKR',
    'Asia/Rangoon':'MMK','Asia/Yangon':'MMK',
    'Asia/Tokyo':'JPY',
    'Asia/Shanghai':'CNY','Asia/Chongqing':'CNY','Asia/Harbin':'CNY',
    'Asia/Hong_Kong':'HKD',
    'Asia/Seoul':'KRW',
    'Asia/Singapore':'SGD',
    'Asia/Taipei':'TWD',
    'Asia/Jakarta':'IDR','Asia/Makassar':'IDR','Asia/Jayapura':'IDR',
    'Asia/Manila':'PHP',
    'Asia/Bangkok':'THB',
    'Asia/Ho_Chi_Minh':'VND','Asia/Saigon':'VND',
    'Asia/Kuala_Lumpur':'MYR',
    'Asia/Dubai':'AED',
    'Asia/Riyadh':'SAR',
    'Asia/Qatar':'QAR','Asia/Doha':'QAR',
    'Asia/Jerusalem':'ILS','Asia/Tel_Aviv':'ILS',
    'Asia/Almaty':'KZT',
    'Europe/London':'GBP',
    'Europe/Berlin':'EUR','Europe/Paris':'EUR','Europe/Rome':'EUR',
    'Europe/Madrid':'EUR','Europe/Lisbon':'EUR','Europe/Amsterdam':'EUR',
    'Europe/Brussels':'EUR','Europe/Vienna':'EUR','Europe/Helsinki':'EUR',
    'Europe/Athens':'EUR','Europe/Luxembourg':'EUR','Europe/Dublin':'EUR',
    'Europe/Warsaw':'PLN','Europe/Prague':'CZK','Europe/Budapest':'HUF',
    'Europe/Bucharest':'RON','Europe/Sofia':'BGN',
    'Europe/Moscow':'RUB','Europe/Samara':'RUB','Europe/Volgograd':'RUB',
    'Europe/Kyiv':'UAH','Europe/Kiev':'UAH',
    'Europe/Istanbul':'TRY',
    'Europe/Zurich':'CHF',
    'Europe/Stockholm':'SEK','Europe/Oslo':'NOK','Europe/Copenhagen':'DKK',
    'America/New_York':'USD','America/Chicago':'USD','America/Denver':'USD',
    'America/Los_Angeles':'USD','America/Phoenix':'USD','America/Anchorage':'USD',
    'America/Honolulu':'USD','America/Indiana/Indianapolis':'USD','America/Detroit':'USD',
    'America/Toronto':'CAD','America/Vancouver':'CAD','America/Edmonton':'CAD',
    'America/Winnipeg':'CAD','America/Halifax':'CAD','America/St_Johns':'CAD',
    'America/Mexico_City':'MXN','America/Cancun':'MXN',
    'America/Sao_Paulo':'BRL','America/Manaus':'BRL','America/Belem':'BRL',
    'America/Buenos_Aires':'ARS','America/Argentina/Buenos_Aires':'ARS',
    'America/Bogota':'COP','America/Lima':'PEN','America/Santiago':'CLP',
    'Africa/Lagos':'NGN','Africa/Nairobi':'KES','Africa/Johannesburg':'ZAR',
    'Africa/Cairo':'EGP','Africa/Accra':'GHS','Africa/Dar_es_Salaam':'TZS',
    'Pacific/Auckland':'NZD','Pacific/Chatham':'NZD',
    'Australia/Sydney':'AUD','Australia/Melbourne':'AUD','Australia/Brisbane':'AUD',
    'Australia/Adelaide':'AUD','Australia/Perth':'AUD',
  };

  function detectCurrency() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (TZ_CURRENCY[tz]) return TZ_CURRENCY[tz];
    } catch (_) {}
    try {
      const lang   = navigator.language || 'en-US';
      const region = (lang.split('-')[1] || lang.split('_')[1] || '').toUpperCase();
      return COUNTRY_CURRENCY[region] || 'USD';
    } catch (_) { return 'USD'; }
  }

  function fmt(n) { return Number(n).toLocaleString(); }

  function fmtLocal(eyes, useRate) {
    const v = localAmt(eyes, useRate);
    return v ? `≈ ${v}` : '';
  }

  function getCurrencyMin() {
    const r = _rates[_currency];
    return r ? r.min_topup : 20;
  }

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
      const sign   = t.amount >= 0 ? '+' : '';
      const cls    = t.amount >= 0 ? 'credits-tx-pos' : 'credits-tx-neg';
      const label  = TX_LABELS[t.tx_type] || t.tx_type;
      const date   = t.created_at ? new Date(t.created_at).toLocaleDateString() : '';
      // Cancelled / rejected requests never moved any Eyes, so don't show a
      // misleading +/- amount — show the outcome instead.
      const voided = (t.status === 'cancelled' || t.status === 'rejected');
      const status = (t.status !== 'completed' && !voided)
        ? `<span class="credits-tx-status credits-tx-status-${t.status}">${t.status}</span>` : '';
      const amtHtml = voided
        ? `<span class="credits-tx-amt credits-tx-void">${t.status === 'rejected' ? 'Rejected' : 'Cancelled'}</span>`
        : `<span class="credits-tx-amt ${cls}">${sign}${fmt(Math.abs(t.amount))} Eyes</span>`;

      let hint   = '';
      let cancel = '';
      // Manual bank-transfer instructions only apply to manual requests (ext_ref empty).
      // Online (Razorpay) orders are paid in the popup — no manual "pay via UPI" tooltip.
      if (t.tx_type === 'topup_request' && t.status === 'pending' && !t.ext_ref) {
        const r      = _rates[t.ref_id] || _rates[_currency];
        const payAmt = r ? localAmt(t.amount, r.buy_rate) : `${fmt(t.amount)} Eyes`;
        hint = `<span class="credits-tx-hint" tabindex="0">⚠<span class="credits-tx-hint-tooltip">` +
          payInstructions(payAmt, t.id, { inline: true }) +
          `</span></span>`;
      }
      if ((t.tx_type === 'topup_request' || t.tx_type === 'sellback_request') && t.status === 'pending') {
        cancel = `<button class="credits-tx-cancel" data-tx="${t.id}">Cancel</button>`;
      }

      return `<div class="credits-tx-row">
        <div class="credits-tx-info">
          <span class="credits-tx-label">${label}</span>
          ${status}${hint}
          <span class="credits-tx-date">${date}</span>
          ${cancel}
        </div>
        ${amtHtml}
      </div>`;
    }).join('');
  }

  function localAmt(eyes, rate) {
    if (!rate || !eyes) return '';
    const val = eyes * rate;
    const r   = _rates[_currency];
    const sym = (r && r.symbol) || _currency;
    if (val >= 1000) return `${sym}${Math.round(val).toLocaleString()}`;
    if (val >= 1)    return `${sym}${val.toFixed(2)}`;
    return `${sym}${val.toFixed(4)}`;
  }

  const UPI_ID = 'veyra4ocellus@nyes';

  function payInstructions(payAmt, txId, { inline = false } = {}) {
    const isINR = _currency === 'INR';
    const payTo = isINR
      ? `<strong>${UPI_ID}</strong><span style="opacity:.45;font-size:.78rem;margin-left:4px;">(UPI)</span>`
      : `<strong>veyrasupportus@gmail.com</strong>`;
    const qr = isINR && !inline
      ? `<img src="/pug_style/upi_qr.jpg" class="cpi-qr" alt="UPI QR code">`
      : '';
    const title = inline ? `<strong>To complete your top-up, send payment:</strong>` : `<div class="cpi-title">To complete your top-up, send payment:</div>`;
    const wrap = (s) => inline ? s : `<div class="cpi-row">${s}</div>`;
    return (
      title +
      wrap(`<span class="cpi-label">Amount</span><strong>${payAmt}</strong>`) +
      wrap(`<span class="cpi-label">Pay to</span>${payTo}`) +
      qr +
      wrap(`<span class="cpi-label">Reference</span><strong>Eyes TopUp #${txId}</strong>`) +
      (inline
        ? `<div class="cpi-note">Eyes will be credited within 24 hours of payment confirmation.</div>`
        : `<div class="cpi-note">Eyes will be credited within 24 hours of payment confirmation.</div>`)
    );
  }

  function updateRateUI() {
    const r   = _rates[_currency];
    const tag = document.getElementById('creditsCurrencyTag');
    const bar = document.getElementById('creditsRateBar');
    const topupMinNote    = document.getElementById('topupMinNote');
    const sellbackMinNote = document.getElementById('sellbackMinNote');

    if (tag) tag.textContent = _currency;

    const min = getCurrencyMin();

    if (r && bar) {
      const buyAmt  = localAmt(min, r.buy_rate);
      const sellAmt = localAmt(min, r.sell_rate);
      bar.textContent = `${min} Eyes = ${buyAmt} to buy · ${sellAmt} to sell back`;
    } else if (bar) {
      bar.textContent = 'Rate unavailable';
    }

    // Update sell-back warning tooltip with local currency example
    const tooltipEx = document.getElementById('warnTooltipExample');
    if (tooltipEx && r) {
      const eg    = 1000;
      const paid  = localAmt(eg, r.buy_rate);
      const back  = localAmt(eg, r.sell_rate);
      const sym   = (r.symbol) || _currency;
      const diff  = ((eg * r.buy_rate) - (eg * r.sell_rate));
      const diffFmt = diff >= 1000
        ? `${sym}${Math.round(diff).toLocaleString()}`
        : `${sym}${diff.toFixed(2)}`;
      tooltipEx.innerHTML =
        `<em>Example in your currency:</em> 1,000 Eyes bought for <strong>${paid}</strong> → ` +
        `sold back for <strong>${back}</strong>. The <strong>${diffFmt} difference</strong> ` +
        `is the spread — that's money lost twice (once buying, once selling), so any ` +
        `cross-currency arbitrage always ends in a net loss.`;
    }

    // Update local currency sub-labels on preset buttons
    document.querySelectorAll('#topupAmountGrid .credits-amt-btn').forEach(btn => {
      const eyes  = parseInt(btn.dataset.amount, 10);
      const label = btn.querySelector('.amt-local');
      if (label) label.textContent = r ? localAmt(eyes, r.buy_rate) : '';
    });

    if (topupMinNote)    topupMinNote.textContent    = `Minimum ${min} Eyes for custom amounts.`;
    if (sellbackMinNote) sellbackMinNote.textContent = `Minimum ${min} Eyes.`;

    // instant-vs-manual copy depends on the selected currency
    updateTopupMode();
    // re-validate current topup selection
    if (_topupSelected !== null) updateTopupSelected(_topupSelected);
    // re-validate sellback input
    const sbInput = document.getElementById('sellbackAmt');
    if (sbInput && sbInput.value) sbInput.dispatchEvent(new Event('input'));
  }

  function loadRates() {
    fetch('/pug/api/wallet/rates')
      .then(r => r.json())
      .then(data => {
        _rates = data;
        updateRateUI();
      })
      .catch(() => {});
  }

  function loadWallet() {
    fetch('/pug/api/wallet')
      .then(r => r.json())
      .then(data => {
        _balance = data.balance || 0;
        if (data.razorpay) _razorpay = data.razorpay;
        const balEl = document.getElementById('creditsBalance');
        if (balEl) balEl.textContent = fmt(_balance);
        const hint = document.getElementById('sellbackBalanceHint');
        if (hint) hint.textContent = `Available: ${fmt(_balance)} Eyes`;
        renderTxList(data.transactions || []);
        updateTopupMode();
      })
      .catch(() => {});
  }

  function cancelTx(txId) {
    fetch(`/pug/api/wallet/tx/${txId}/cancel`, { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (d.ok) loadWallet(); })
      .catch(() => {});
  }

  // ── TopUp ─────────────────────────────────────────────────────────────────

  function updateTopupSelected(amount) {
    _topupSelected      = amount;
    const min           = getCurrencyMin();
    const row           = document.getElementById('topupSelectedRow');
    const val           = document.getElementById('topupSelectedVal');
    const hint          = document.getElementById('topupConvHint');
    const btn           = document.getElementById('topupSubmitBtn');
    if (amount && amount >= min) {
      row.style.display = '';
      val.textContent   = fmt(amount);
      if (hint) hint.textContent = fmtLocal(amount, (_rates[_currency] || {}).buy_rate || 0);
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
      const min = getCurrencyMin();
      if (!_topupSelected || _topupSelected < min) return;
      const inst = document.getElementById('topupPaymentInst');
      submit.disabled = true;
      msg.textContent = '';
      if (inst) inst.style.display = 'none';
      // INR users with online pay available → instant, verified Razorpay Checkout.
      // Everyone else → the manual request + pay-by-UPI/email instructions (admin credits).
      if (canUseRazorpay()) {
        submitRazorpayTopup(_topupSelected, submit, msg, inst);
      } else {
        submitManualTopup(_topupSelected, submit, msg, inst);
      }
    });
  }

  // Offer Razorpay when the currency is INR (it settles INR) and the server says it's
  // configured. Checkout.js itself loads in the popup window, not here.
  function canUseRazorpay() {
    return _currency === 'INR' && _razorpay.enabled && !!_razorpay.key_id;
  }

  // Reflect instant (Razorpay) vs manual crediting in the button + fine print.
  function updateTopupMode() {
    const btn  = document.getElementById('topupSubmitBtn');
    const fine = document.getElementById('topupFinePrint');
    const instant = canUseRazorpay();
    if (btn) btn.textContent = instant ? 'Pay & Top Up' : 'Request Top Up';
    if (fine) fine.innerHTML = (instant
      ? 'Pay securely via UPI, card, or netbanking — Eyes are added instantly. '
      : 'Eyes are added after payment is confirmed by our team. ')
      + '<a href="/pug/terms#credits" target="_blank">Terms apply.</a>';
  }

  function submitManualTopup(amount, submit, msg, inst) {
    fetch('/pug/api/wallet/topup', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ amount, currency: _currency }),
    })
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (ok) {
          setMsg(msg, `Request #${d.tx_id} created for ${fmt(amount)} Eyes.`, false);
          if (inst) {
            const r      = _rates[_currency];
            const payAmt = r ? localAmt(amount, r.buy_rate) : `${amount} Eyes`;
            inst.innerHTML = payInstructions(payAmt, d.tx_id);
            inst.style.display = '';
          }
          loadWallet();
        } else {
          setMsg(msg, d.error || 'Something went wrong', true);
          submit.disabled = false;
        }
      })
      .catch(() => {
        setMsg(msg, 'Network error — your request may still be processing. Check pending transactions below before retrying.', true);
        loadWallet();
        setTimeout(() => { submit.disabled = false; }, 8000);
      });
  }

  // The home page is cross-origin-isolated (COOP/COEP) so BlinkBot's WASM runs
  // multithreaded — but that isolation blocks embedding Razorpay's checkout iframe
  // inline. So we run Checkout in a separate, NON-isolated popup window (/pug/pay) and
  // listen for its postMessage result. A backdrop keeps the user anchored to the flow
  // so the popup can't get lost behind the main window.
  function submitRazorpayTopup(amount, submit, msg, inst) {
    var startBal = _balance;          // wallet poll below treats a rise of >= amount as paid
    var w = 480, h = 660;
    var left = Math.max(0, ((window.screen.width || 1200) - w) / 2);
    var top  = Math.max(0, ((window.screen.height || 800) - h) / 2);
    var popup = window.open('/pug/pay?amount=' + encodeURIComponent(amount), 'veyra_pay',
      'popup=yes,width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
    if (!popup) {
      setMsg(msg, 'Your browser blocked the payment window — allow popups for this site, then try again.', true);
      submit.disabled = false;
      return;
    }
    try { popup.focus(); } catch (e) {}   // may be a no-op (opener is severed under COOP) — harmless
    setMsg(msg, 'Complete your payment in the popup window…', false);

    var overlay = buildPayOverlay(function () { finish('cancelled'); });
    var settled = false;
    var bc = null;
    try { bc = new BroadcastChannel('veyra-pay'); } catch (e) {}

    function finish(kind, extra) {
      if (settled) return;
      settled = true;
      if (bc) { try { bc.close(); } catch (e) {} }
      window.removeEventListener('message', onWinMsg);
      window.removeEventListener('storage', onStorage);
      clearInterval(poll);
      clearTimeout(timeout);
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      try { if (popup && !popup.closed) popup.close(); } catch (e) {}
      submit.disabled = false;
      if (kind === 'success')        setMsg(msg, 'Payment successful — ' + fmt(amount) + ' Eyes added!', false);
      else if (kind === 'cancelled') setMsg(msg, 'Payment cancelled.', true);
      else if (kind === 'failed')    setMsg(msg, (extra && extra.error) ? ('Payment failed: ' + extra.error) : 'Payment failed.', true);
      else if (kind === 'pending')   setMsg(msg, 'Payment received — confirming… your Eyes will appear shortly.', false);
      loadWallet();
    }
    // A signal from the payment popup (via BroadcastChannel / storage / postMessage).
    function handle(data) {
      if (!data || data.source !== 'veyra-pay') return;
      var s = data.status;
      if (s === 'success')      finish('success');
      else if (s === 'cancelled') finish('cancelled');
      else if (s === 'failed' || s === 'error') finish('failed', data);
      else if (s === 'pending') finish('pending');
    }
    function onWinMsg(e) { if (e.origin === location.origin) handle(e.data); }
    function onStorage(e) { if (e.key === 'veyra_pay_result' && e.newValue) { try { handle(JSON.parse(e.newValue)); } catch (x) {} } }
    if (bc) bc.onmessage = function (e) { handle(e.data); };
    window.addEventListener('message', onWinMsg);
    window.addEventListener('storage', onStorage);

    // Source of truth: poll the wallet. If the balance rises by the top-up amount, the
    // payment cleared (via verify OR the webhook) — this works even if every message
    // channel above failed.
    var poll = setInterval(function () {
      if (settled) return;
      fetch('/pug/api/wallet').then(function (r) { return r.json(); }).then(function (d) {
        if (!settled && (d.balance || 0) >= startBal + amount) { _balance = d.balance; finish('success'); }
      }).catch(function () {});
    }, 2500);
    // Give up quietly after 10 min so we never leave the backdrop stuck.
    var timeout = setTimeout(function () { finish('cancelled'); }, 10 * 60 * 1000);
  }

  // Backdrop on the main page while the payment popup is open. (Under the home page's
  // COOP isolation the browser severs our handle to the popup, so we can't focus it
  // programmatically — we point the user at their taskbar instead.)
  function buildPayOverlay(onCancel) {
    var ov = document.createElement('div');
    ov.className = 'pay-overlay';
    ov.innerHTML =
      '<div class="pay-overlay-box">' +
        '<div class="pay-overlay-title">Finish your payment</div>' +
        '<div class="pay-overlay-text">A secure Razorpay window is open — complete your payment there. ' +
        'Don’t see it? Check your taskbar or Alt-Tab. Your Eyes are added the moment it succeeds.</div>' +
        '<div class="pay-overlay-actions">' +
          '<button type="button" class="pay-overlay-cancel">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.querySelector('.pay-overlay-cancel').addEventListener('click', function () { onCancel(); });
    return ov;
  }

  // ── SellBack ──────────────────────────────────────────────────────────────

  function initSellback() {
    const input  = document.getElementById('sellbackAmt');
    const submit = document.getElementById('sellbackSubmitBtn');
    const msg    = document.getElementById('sellbackMsg');
    const hint   = document.getElementById('sellbackConvHint');
    if (!input) return;

    input.addEventListener('input', () => {
      const v   = parseInt(input.value, 10);
      const min = getCurrencyMin();
      submit.disabled = isNaN(v) || v < min || v > _balance;
      if (hint) {
        hint.textContent = (!isNaN(v) && v > 0)
          ? fmtLocal(v, (_rates[_currency] || {}).sell_rate || 0)
          : '';
      }
    });

    submit.addEventListener('click', () => {
      const v   = parseInt(input.value, 10);
      const min = getCurrencyMin();
      if (isNaN(v) || v < min) return;
      submit.disabled = true;
      msg.textContent = '';
      fetch('/pug/api/wallet/sellback', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ amount: v, currency: _currency }),
      })
        .then(r => r.json().then(d => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          if (ok) {
            setMsg(msg, d.message || 'Request submitted!', false);
            input.value = '';
            if (hint) hint.textContent = '';
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

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    _currency = detectCurrency();
    const refreshBtn = document.getElementById('creditsRefreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => { loadRates(); loadWallet(); });
    const txList = document.getElementById('creditsTxList');
    if (txList) txList.addEventListener('click', e => {
      const btn = e.target.closest('.credits-tx-cancel');
      if (btn) cancelTx(parseInt(btn.dataset.tx, 10));
    });
    initTopup();
    initSellback();
    // Guests have no wallet — skip the authed loads (the UI handlers above are harmless).
    if (!window.VEYRA_GUEST) { loadRates(); loadWallet(); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  document.addEventListener('veyra:navigate', e => {
    if (e.detail && e.detail.route === 'credits') { loadRates(); loadWallet(); }
  });
})();
