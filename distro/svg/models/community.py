"""
svg community models: CommunityPost (with up/down votes), PostVote, PostComment, and
Challenges (Challenge + ChallengeMember). Note: this is svg's OWN community — separate
from pug's, which instead stores posts as Note rows.
"""
from shared.extensions import db
from datetime import datetime


class CommunityPost(db.Model):
    __tablename__ = 'community_posts'
    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    distro     = db.Column(db.String(20), nullable=False)
    title      = db.Column(db.String(200), nullable=False)
    body       = db.Column(db.Text, nullable=False)
    image_url  = db.Column(db.String(500), nullable=True)
    tag        = db.Column(db.String(20), default='general')
    vote_count = db.Column(db.Integer, default=0)
    is_global  = db.Column(db.Boolean, default=False)  # True = shared into the all-distros feed
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    author   = db.relationship('User', backref='posts',    lazy=True)
    comments = db.relationship('PostComment',  backref='post', lazy=True, cascade='all, delete-orphan')
    votes    = db.relationship('PostVote',     backref='post', lazy=True, cascade='all, delete-orphan')


class PostVote(db.Model):
    __tablename__ = 'post_votes'
    id      = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey('community_posts.id', ondelete='CASCADE'), nullable=False)
    __table_args__ = (db.UniqueConstraint('user_id', 'post_id'),)


class PostComment(db.Model):
    __tablename__ = 'post_comments'
    id         = db.Column(db.Integer, primary_key=True)
    post_id    = db.Column(db.Integer, db.ForeignKey('community_posts.id', ondelete='CASCADE'), nullable=False)
    user_id    = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    body       = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    author     = db.relationship('User', backref='comments', lazy=True)


class Challenge(db.Model):
    __tablename__ = 'challenges'
    id            = db.Column(db.Integer, primary_key=True)
    creator_id    = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    distro        = db.Column(db.String(20), nullable=False)
    scope         = db.Column(db.String(10), default='local')
    title         = db.Column(db.String(200), nullable=False)
    habit_name    = db.Column(db.String(200), nullable=False)
    duration_days = db.Column(db.Integer, default=30)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)
    creator       = db.relationship('User', backref='challenges', lazy=True)
    members       = db.relationship('ChallengeMember', backref='challenge', lazy=True, cascade='all, delete-orphan')


class ChallengeMember(db.Model):
    __tablename__ = 'challenge_members'
    id           = db.Column(db.Integer, primary_key=True)
    challenge_id = db.Column(db.Integer, db.ForeignKey('challenges.id', ondelete='CASCADE'), nullable=False)
    user_id      = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    joined_at    = db.Column(db.DateTime, default=datetime.utcnow)
    __table_args__ = (db.UniqueConstraint('challenge_id', 'user_id'),)