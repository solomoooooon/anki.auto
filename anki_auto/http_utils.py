import json
from http.server import BaseHTTPRequestHandler
import re
from urllib.parse import urlsplit


class APIError(Exception):
    def __init__(self, message, status=400, details=None):
        super().__init__(message)
        self.status = status
        self.details = details


def extension_origin(origin):
    return bool(re.fullmatch(r"chrome-extension://[a-p]{32}", origin or ""))


class JSONHandler(BaseHTTPRequestHandler):
    server_version = "anki.auto"

    def log_message(self, *_):
        pass  # Avoid logging selected text, pairing codes, or tokens.

    def send_json(self, status, value):
        encoded = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        origin = self.headers.get("Origin", "")
        if extension_origin(origin) and self.cors_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        self.wfile.write(encoded)

    def cors_allowed(self, origin):
        return False

    def run_request(self):
        try:
            host = self.headers.get("Host", "")
            if host not in (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"):
                raise APIError("Invalid local Host", 403)
            if self.command == "OPTIONS":
                if not self.cors_allowed(self.headers.get("Origin", "")):
                    raise APIError("Origin not allowed", 403)
                self.send_json(200, {"ok": True})
                return
            payload = {}
            if self.command == "POST":
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 1_000_000:
                    raise APIError("Request body missing or too large", 413)
                if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise APIError("Expected application/json", 415)
                payload = json.loads(self.rfile.read(size))
                if not isinstance(payload, dict):
                    raise APIError("Expected a JSON object")
            result = self.route(urlsplit(self.path).path, payload)
            self.send_json(200, dict(ok=True, result=result))
        except APIError as error:
            self.send_json(error.status, dict(ok=False, error=str(error), details=error.details))
        except (ValueError, KeyError, TypeError) as error:
            self.send_json(400, dict(ok=False, error=str(error)))
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            self.send_json(503, dict(ok=False, error="Local service unavailable. Check Anki and the backend console."))

    do_GET = run_request
    do_POST = run_request
    do_OPTIONS = run_request
