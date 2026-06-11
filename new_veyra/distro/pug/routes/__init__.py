"""
Ocellus route package.

The blueprint is defined here; each feature area lives in its own module and
registers onto `pug_bp` at import time.  URL paths are unchanged from the
previous generation so shared auth redirects and any saved links keep working.
"""
from flask import Blueprint

pug_bp = Blueprint(
    'pug',
    __name__,
    static_folder='../static',
    static_url_path='/pug_style',
    template_folder='../templates',
)

# Feature modules — import order only matters for before_request hooks (pages first).
from . import pages        # noqa: E402,F401
from . import notes_goals  # noqa: E402,F401
from . import habits       # noqa: E402,F401
from . import media        # noqa: E402,F401
from . import stats        # noqa: E402,F401
from . import profile      # noqa: E402,F401
from . import achievements # noqa: E402,F401
from . import community    # noqa: E402,F401
from . import dms          # noqa: E402,F401
from . import wallet       # noqa: E402,F401
from . import ama          # noqa: E402,F401
from . import assist       # noqa: E402,F401
