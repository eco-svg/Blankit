"""Eyes wallet: balance, FX rates, top-up / sell-back requests, cancellation.

Top-ups and sell-backs create *pending* transactions only — balances change
when the operator confirms payment, never from a client request.
"""
from datetime import datetime, timedelta

from flask import jsonify, request, session

from shared.extensions import db, limiter
from distro.pug.models import EyeRate, Wallet, WalletTx, refresh_eye_rates
from . import pug_bp
from .guards import login_required

MAX_TOPUP = 500_000


def get_or_create_wallet(user_id):
    w = Wallet.query.filter_by(user_id=user_id).first()
    if not w:
        w = Wallet(user_id=user_id, balance=0)
        db.session.add(w)
        db.session.commit()
    return w


def _currency_min(currency):
    if not currency:
        return 20
    r = db.session.get(EyeRate, currency.upper())
    return r.min_topup if r else 20


@pug_bp.route('/pug/api/wallet', methods=['GET'])
@login_required
def get_wallet():
    uid = session['user_id']
    w   = get_or_create_wallet(uid)
    txs = (WalletTx.query
           .filter_by(user_id=uid)
           .order_by(WalletTx.created_at.desc())
           .limit(20).all())
    return jsonify({
        'balance': w.balance,
        'transactions': [{
            'id':         t.id,
            'tx_type':    t.tx_type,
            'amount':     t.amount,
            'ref_id':     t.ref_id,
            'note':       t.note,
            'status':     t.status,
            'created_at': t.created_at.isoformat() if t.created_at else None,
        } for t in txs],
    })


@pug_bp.route('/pug/api/wallet/rates', methods=['GET'])
@login_required
def get_eye_rates():
    refresh_eye_rates()  # no-op if fresh
    rows = EyeRate.query.all()
    return jsonify({r.currency: {
        'buy_rate':  float(r.buy_rate),
        'sell_rate': float(r.sell_rate),
        'min_topup': r.min_topup,
        'symbol':    r.symbol,
    } for r in rows})


@pug_bp.route('/pug/api/wallet/topup', methods=['POST'])
@limiter.limit("10 per hour")
@login_required
def wallet_topup():
    uid      = session['user_id']
    body     = request.get_json(silent=True) or {}
    amount   = body.get('amount')
    currency = (body.get('currency') or 'USD').upper()
    min_eyes = _currency_min(currency)
    if not isinstance(amount, int) or isinstance(amount, bool) or amount < min_eyes:
        return jsonify({'error': f'Minimum top-up is {min_eyes} Eyes for {currency}'}), 400
    if amount > MAX_TOPUP:
        return jsonify({'error': 'Maximum top-up is 500,000 Eyes per request'}), 400
    # Idempotency: return the existing pending request for same amount+currency (5 min window)
    cutoff = datetime.utcnow() - timedelta(minutes=5)
    existing = WalletTx.query.filter_by(
        user_id=uid, tx_type='topup_request', amount=amount, ref_id=currency, status='pending'
    ).filter(WalletTx.created_at >= cutoff).first()
    if existing:
        return jsonify({'ok': True, 'tx_id': existing.id,
                        'message': 'Top-up request already pending.'})
    tx = WalletTx(
        user_id=uid, tx_type='topup_request', amount=amount, ref_id=currency,
        note=f'Top-up request: {amount} Eyes ({currency})', status='pending',
    )
    db.session.add(tx)
    db.session.commit()
    return jsonify({'ok': True, 'tx_id': tx.id,
                    'message': 'Top-up request received. Eyes will be added after payment is confirmed.'})


@pug_bp.route('/pug/api/wallet/sellback', methods=['POST'])
@limiter.limit("10 per hour")
@login_required
def wallet_sellback():
    uid      = session['user_id']
    body     = request.get_json(silent=True) or {}
    amount   = body.get('amount')
    currency = (body.get('currency') or 'USD').upper()
    min_eyes = _currency_min(currency)
    if not isinstance(amount, int) or isinstance(amount, bool) or amount < min_eyes:
        return jsonify({'error': f'Minimum sell-back is {min_eyes} Eyes for {currency}'}), 400
    w = get_or_create_wallet(uid)
    if w.balance < amount:
        return jsonify({'error': 'Insufficient balance'}), 400
    tx = WalletTx(
        user_id=uid, tx_type='sellback_request', amount=-amount, ref_id=currency,
        note=f'Sell-back request: {amount} Eyes ({currency})', status='pending',
    )
    db.session.add(tx)
    db.session.commit()
    return jsonify({'ok': True, 'tx_id': tx.id,
                    'message': 'Sell-back request received. Payout will be processed within 3–5 business days.'})


@pug_bp.route('/pug/api/wallet/tx/<int:tx_id>/cancel', methods=['POST'])
@login_required
def cancel_wallet_tx(tx_id):
    uid = session['user_id']
    tx  = WalletTx.query.filter_by(id=tx_id, user_id=uid).first()
    if not tx:
        return jsonify({'error': 'Not found'}), 404
    if tx.status != 'pending':
        return jsonify({'error': 'Only pending requests can be cancelled'}), 400
    if tx.tx_type not in ('topup_request', 'sellback_request'):
        return jsonify({'error': 'This transaction cannot be cancelled'}), 400
    tx.status = 'cancelled'
    db.session.commit()
    return jsonify({'ok': True})
