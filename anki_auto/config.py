import json
import os
from pathlib import Path
import secrets


class Settings:
    def __init__(self, directory=None):
        self.directory = Path(directory or os.environ.get("ANKI_AUTO_HOME") or
            Path(os.environ.get("LOCALAPPDATA", Path.home())) / "anki.auto")
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / "settings.json"
        if self.path.is_file():
            self.data = json.loads(self.path.read_text(encoding="utf-8"))
        else:
            self.data = dict(backend_port=8766, bridge_port=8767,
                backend_token=secrets.token_urlsafe(32), bridge_token=secrets.token_urlsafe(32),
                origins=[], model="gpt-5.6-luna")
            self.save()

    def save(self):
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
        try:
            temporary.chmod(0o600)
        except OSError:
            pass
        temporary.replace(self.path)
