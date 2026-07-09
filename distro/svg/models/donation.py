"""
distro/svg/models/donation.py — record of a one-off support donation.

SVG donations are collected through the SHARED Razorpay account (the owner's), because
the svg partner has no account of their own yet. So every row is tagged with `distro`
and the Razorpay ids — that's what lets the owner reconcile exactly how much of the
money in their account actually belongs to the partner and needs forwarding.
"""
from datetime import datetime
from shared.extensions import db


class Donation(db.Model):
    __tablename__ = 'donations'
    id                  = db.Column(db.Integer, primary_key=True)
    user_id             = db.Column(db.Integer)                    # who donated (logged-in), if known
    distro              = db.Column(db.String(30), nullable=False, default='Eco-Svg')  # reconciliation tag
    amount_paise        = db.Column(db.Integer, nullable=False)    # Razorpay works in paise (₹1 = 100)
    currency            = db.Column(db.String(10), default='INR')
    razorpay_order_id   = db.Column(db.String(64))
    razorpay_payment_id = db.Column(db.String(64))
    status              = db.Column(db.String(20), default='created')  # created | paid
    created_at          = db.Column(db.DateTime, default=datetime.utcnow)
