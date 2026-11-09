"""Anki entry point. Importing this package outside Anki has no side effects."""

try:
    import aqt
except ImportError:
    aqt = None

if aqt is not None and getattr(aqt, "mw", None) is not None:
    from .server import install
    install()
