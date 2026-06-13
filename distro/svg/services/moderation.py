"""
moderation.py — NSFW image moderation using a local HuggingFace model.
Lazy-loads the model on first use. Disable with DISABLE_NSFW_CHECK=true
(useful on low-RAM hosts like Render free tier).
"""

import os
import io
import warnings

_classifier = None
_DISABLED   = os.environ.get('DISABLE_NSFW_CHECK', 'false').lower() == 'true'


def _get_classifier():
    global _classifier
    if _classifier is None:
        from transformers import pipeline
        _classifier = pipeline(
            'image-classification',
            model='Falconsai/nsfw_image_detection',
        )
    return _classifier


def check_image_safe(file_bytes: bytes) -> tuple[bool, str]:
    """
    Returns (is_safe, reason).
    If DISABLE_NSFW_CHECK=true, always returns (True, 'check disabled').
    """
    if _DISABLED:
        return True, 'check disabled'

    try:
        from PIL import Image
        clf   = _get_classifier()
        img   = Image.open(io.BytesIO(file_bytes)).convert('RGB')
        result = clf(img)

        # result is a list like [{'label': 'normal', 'score': 0.98}, {'label': 'nsfw', 'score': 0.02}]
        nsfw_score = next((r['score'] for r in result if r['label'].lower() == 'nsfw'), 0.0)

        if nsfw_score > 0.5:
            return False, f'flagged as nsfw (score={nsfw_score:.2f})'
        return True, 'ok'

    except Exception as e:
        warnings.warn(f'[moderation] NSFW check failed, allowing image: {e}')
        return True, f'check error (allowed): {e}'