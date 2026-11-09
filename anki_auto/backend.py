import argparse
from dataclasses import replace
from concurrent.futures import ThreadPoolExecutor
import hashlib
import hmac
from http.server import ThreadingHTTPServer
import json
import secrets
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import Settings
from .contracts import CaptureRequest, CardContent, manual_content
from .generator import CodexGenerator, cache_key
from .http_utils import APIError, JSONHandler, extension_origin
from .store import Store


class BridgeClient:
    def __init__(self, settings):
        self.settings = settings

    def call(self, action, payload):
        req = Request(f'http://127.0.0.1:{self.settings.data["bridge_port"]}/rpc',
            data=json.dumps(dict(action=action, payload=payload)).encode(),
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + self.settings.data["bridge_token"]})
        try:
            with urlopen(req, timeout=20) as response:
                result = json.load(response)
        except HTTPError as error:
            try:
                detail = json.load(error)
                raise ValueError(detail.get("error", "Anki operation failed")) from error
            except json.JSONDecodeError:
                raise RuntimeError("Anki bridge returned an invalid response") from error
        except (URLError, TimeoutError) as error:
            raise RuntimeError("Open Anki with the anki.auto add-on installed, then retry.") from error
        if not result.get("ok"):
            raise ValueError(result.get("error", "Anki operation failed"))
        return result["result"]


class Application:
    def __init__(self, settings, bridge=None, generator=None):
        self.settings = settings
        self.bridge = bridge or BridgeClient(settings)
        self.generator = generator or CodexGenerator(settings.directory / "worker", model=settings.data["model"])
        self.store = Store(settings.directory / "captures.sqlite3")
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="anki-auto-capture")
        self.lock = threading.RLock()
        self.pair_code = secrets.token_urlsafe(9)
        self.pair_deadline = time.monotonic() + 600
        for identifier in self.store.recoverable():
            self.executor.submit(self.process, identifier)

    def close(self):
        self.executor.shutdown(wait=True, cancel_futures=True)

    def matches(self, request):
        response = self.bridge.call("matches", dict(deck_id=request.deck_id, expression=request.expression))
        message = json.dumps([request.deck_id, request.expression, response["fingerprint"]], ensure_ascii=False).encode()
        response["ack_token"] = hmac.new(self.settings.data["backend_token"].encode(), message, hashlib.sha256).hexdigest()
        return response

    def check_matches(self, request):
        matches = self.matches(request)
        if matches["matches"] and not hmac.compare_digest(request.duplicate_ack, matches["ack_token"]):
            raise APIError("Similar cards already exist in this destination deck", 409, matches)
        return matches

    def submit(self, payload):
        request = CaptureRequest.from_dict(payload)
        with self.lock:
            collection = self.bridge.call("health", {})["collection_id"]
            if request.collection_id and request.collection_id != collection:
                raise ValueError("The Anki collection changed. Reopen this capture in the intended profile.")
            request = replace(request, collection_id=collection)
            existing = self.store.job(request.request_id)
            if existing and existing["hash"] != Store.identity(request):
                raise APIError("This capture ID belongs to a different draft", 409)
            if existing and existing["status"] in ("done", "running", "queued", "saving"):
                return self.public_job(existing)
            self.check_matches(request)
            # Validate a manual example before starting a job, with no model access.
            if request.custom_definition:
                manual_content(request)
            job, created = self.store.put(request, retry=bool(payload.get("retry")))
            if created:
                self.executor.submit(self.process, request.request_id)
            return self.public_job(job)

    @staticmethod
    def public_job(job):
        return {key: job[key] for key in ("id", "status", "result", "error")}

    def process(self, identifier):
        try:
            job = self.store.job(identifier)
            if not job or job["status"] == "cancelled":
                return
            request = CaptureRequest.from_dict(job["payload"])
            self.store.update(identifier, "running")
            if request.collection_id != self.bridge.call("health", {})["collection_id"]:
                raise ValueError("The Anki collection changed. Open the original profile and retry.")
            # Anki's stable RequestId closes the save/HTTP-response crash window.
            already = self.bridge.call("capture_status", {"request_id": identifier})["capture"]
            if already:
                self.store.update(identifier, "done", already)
                return
            if request.custom_definition:
                content = manual_content(request)
            else:
                key = cache_key(request, self.generator.model)
                cached = self.store.cached(key)
                content = CardContent.from_dict(cached, request) if cached else self.generator.generate(request,
                    cancelled=lambda: self.store.job(identifier)["status"] == "cancelled")
                if not cached:
                    self.store.cache(key, content.to_dict())
            with self.lock:
                if self.store.job(identifier)["status"] == "cancelled":
                    return
                if request.collection_id != self.bridge.call("health", {})["collection_id"]:
                    raise ValueError("The Anki collection changed during generation. Open the original profile and retry.")
                matched = self.check_matches(request)
                self.store.update(identifier, "saving")
                result = self.bridge.call("add", dict(request=request.to_dict(), content=content.to_dict(),
                    matches_fingerprint=matched["fingerprint"], allow_matches=bool(matched["matches"])))
                self.store.update(identifier, "done", result)
        except APIError as error:
            self.store.update(identifier, "needs_confirmation", error.details, str(error))
        except Exception as error:
            if self.store.job(identifier)["status"] != "cancelled":
                self.store.update(identifier, "failed", error=str(error)[:2000])

    def route(self, method, path, data, origin):
        if path == "/health":
            try:
                bridge = self.bridge.call("health", {})
            except (RuntimeError, ValueError) as error:
                bridge = dict(connected=False, error=str(error))
            return dict(service="anki.auto", bridge=bridge, model=self.generator.model)
        if path == "/decks" and method == "GET":
            return self.bridge.call("decks", {})
        if path == "/matches" and method == "POST":
            request = CaptureRequest.from_dict(dict(request_id="match", **data))
            return self.matches(request)
        if path == "/captures" and method == "POST":
            return self.submit(data)
        if path.startswith("/jobs/"):
            identifier = path.split("/")[-1]
            job = self.store.job(identifier)
            if not job:
                raise APIError("Capture not found", 404)
            if method == "POST" and data.get("cancel"):
                with self.lock:
                    if self.store.job(identifier)["status"] in ("queued", "running"):
                        self.store.update(identifier, "cancelled", error="Cancelled; draft retained")
            return self.public_job(self.store.job(identifier))
        actions = {"/review/start":"review_start", "/review/current":"review_current", "/review/action":"review_action",
            "/review/end":"review_end", "/notes/edit":"edit", "/notes/get":"note", "/media":"media",
            "/review/info":"review_info", "/review/open":"review_open", "/review/options":"review_options"}
        if path in actions and (method == "POST" or path == "/review/current"):
            return self.bridge.call(actions[path], data)
        if path == "/codex/status" and method == "GET":
            return self.generator.status()
        raise APIError("Unknown endpoint", 404)


def make_server(app, port=None):
    class Handler(JSONHandler):
        def cors_allowed(self, origin):
            return extension_origin(origin) and (origin in app.settings.data["origins"] or self.path in ("/pair", "/health"))

        def route(self, path, payload):
            origin = self.headers.get("Origin", "")
            if path == "/pair" and self.command == "POST":
                if not extension_origin(origin) or time.monotonic() > app.pair_deadline or not app.pair_code or not hmac.compare_digest(str(payload.get("code", "")), app.pair_code):
                    raise APIError("Pairing code invalid or expired. Restart the backend for a new code.", 403)
                with app.lock:
                    if origin not in app.settings.data["origins"]:
                        app.settings.data["origins"].append(origin)
                        app.settings.save()
                    app.pair_code = None
                return {"token": app.settings.data["backend_token"]}
            supplied = self.headers.get("Authorization", "")
            if not hmac.compare_digest(supplied, "Bearer " + app.settings.data["backend_token"]):
                if path == "/health" and self.command == "GET":
                    return {"service": "anki.auto", "paired": False}
                raise APIError("Pair this extension with the local backend first", 401)
            if origin and origin not in app.settings.data["origins"]:
                raise APIError("Extension origin not paired", 403)
            return app.route(self.command, path, payload, origin)
    return ThreadingHTTPServer(("127.0.0.1", app.settings.data["backend_port"] if port is None else port), Handler)


def main():
    parser = argparse.ArgumentParser(description="anki.auto local backend")
    parser.add_argument("--home", default=None)
    args = parser.parse_args()
    settings = Settings(args.home)
    app = Application(settings)
    server = make_server(app)
    print(f"anki.auto backend running at http://127.0.0.1:{server.server_port}")
    print("Pairing code (valid for 10 minutes):", app.pair_code, flush=True)
    print("Open Anki and pair the extension. Keep this console running. Ctrl+C stops it.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        app.close()


if __name__ == "__main__":
    main()
