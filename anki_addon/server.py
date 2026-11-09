"""Authenticated listener; every Anki operation is marshalled onto its GUI thread."""
from concurrent.futures import Future, TimeoutError
import hashlib
import hmac
from http.server import ThreadingHTTPServer
import threading

import aqt
from aqt import gui_hooks
from aqt.qt import QAction

try:
    from ._shared.config import Settings
    from ._shared.http_utils import APIError, JSONHandler
except ImportError:
    from anki_auto.config import Settings
    from anki_auto.http_utils import APIError, JSONHandler
from .core import AnkiService

_server = None
_service = None


def install():
    global _server
    settings = Settings()

    def service():
        global _service
        mw = aqt.mw
        if not mw or not mw.col:
            raise ValueError("Open an Anki profile first")
        if _service is None or _service.col is not mw.col:
            profile = mw.pm.name
            key = hashlib.sha256((mw.col.path + profile).encode()).hexdigest()[:20]
            _service = AnkiService(mw.col, profile, settings.directory / ("session-" + key + ".json"))
        return _service

    def invoke(action, payload):
        current = service()
        if action in ("review_open", "review_options"):
            if not current.session or not current.session.current_id:
                raise ValueError("No review card is selected")
            current.session.guard()
            if action == "review_open":
                browser = aqt.dialogs.open("Browser", aqt.mw)
                browser.search_for(f"nid:{current.session.current_card.nid}")
            else:
                from aqt.deckoptions import DeckOptionsDialog
                card = current.session.current_card
                DeckOptionsDialog(aqt.mw, card.odid or card.did)
            return {"opened": True}
        result = current.dispatch(action, payload)
        if action in ("add", "edit", "review_action", "review_end"):
            # Refresh deck counts without moving the desktop reviewer onto a different card.
            aqt.mw.requireReset()
        return result

    class Handler(JSONHandler):
        def route(self, path, payload):
            settings_now = Settings()
            if self.headers.get("Origin"):
                raise APIError("Browser requests are not accepted by the Anki bridge", 403)
            if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + settings_now.data["bridge_token"]):
                raise APIError("Invalid bridge token", 401)
            if path != "/rpc" or self.command != "POST":
                raise APIError("Unknown bridge endpoint", 404)
            future = Future()
            def on_main():
                if future.set_running_or_notify_cancel():
                    try:
                        future.set_result(invoke(payload["action"], payload.get("payload", {})))
                    except Exception as error:
                        future.set_exception(error)
            aqt.mw.taskman.run_on_main(on_main)
            try:
                return future.result(timeout=15)
            except TimeoutError:
                future.cancel()
                raise APIError("Anki is busy. Close blocking dialogs and retry.", 503)

    try:
        _server = ThreadingHTTPServer(("127.0.0.1", settings.data["bridge_port"]), Handler)
        threading.Thread(target=_server.serve_forever, name="anki-auto-bridge", daemon=True).start()
    except OSError:
        from aqt.utils import showWarning
        gui_hooks.profile_did_open.append(lambda: showWarning("anki.auto could not open its local port. Check for another Anki process or change bridge_port in the local settings."))

    def clear_service():
        global _service
        _service = None
    gui_hooks.profile_will_close.append(clear_service)
    action = QAction("anki.auto connection", aqt.mw)
    def show_connection():
        from aqt.utils import showInfo
        showInfo(f"anki.auto bridge: 127.0.0.1:{settings.data['bridge_port']}\nStart the Python backend, then pair the Chrome extension.\nRuntime settings: {settings.path}")
    action.triggered.connect(show_connection)
    aqt.mw.form.menuTools.addAction(action)
