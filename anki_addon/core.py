import base64
import hashlib
import html
import json
import mimetypes
from pathlib import Path

from anki_auto.contracts import CaptureRequest, CardContent, text
from anki_auto.matching import find_matches, fingerprint, plain
from .review import ReviewSession

MODEL = "anki.auto Vocabulary"
FIELDS = ["Front", "Back", "ExampleFront", "ExampleBack", "SourceTerm", "Language", "Context", "SourceURL", "SourceTitle", "RequestId", "RequestHash"]


def escape(value):
    return html.escape(value).replace("\n", "<br>")


class AnkiService:
    def __init__(self, col, profile, state_path=None):
        self.col = col
        self.profile = profile
        self.session = None
        self.state_path = Path(state_path) if state_path else Path(col.path).with_suffix(".anki-auto-session.json")
        try:
            self.recovery = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.recovery = None

    def deck(self, deck_id):
        if not isinstance(deck_id, int) or isinstance(deck_id, bool):
            raise ValueError("Invalid deck")
        deck = self.col.decks.get_legacy(deck_id)
        if not deck or deck["dyn"]:
            raise ValueError("Choose a normal destination deck")
        return deck

    def records(self, deck_id):
        self.deck(deck_id)
        ids = self.col.db.list("select distinct nid from cards where (did = ? and odid = 0) or odid = ?", deck_id, deck_id)
        records = []
        for note_id in ids:
            note = self.col.get_note(note_id)
            fields = dict(note.items())
            our = note.note_type()["name"] == MODEL
            term = fields.get("Back", "") if our else next(iter(fields.values()), "")
            front = fields.get("Front", "") if our else " · ".join(list(fields.values())[1:])
            texts = [fields.get("SourceTerm", ""), term] if our else list(fields.values())
            records.append(dict(note_id=note_id, term=term, front=front, texts=texts, modified=note.mod))
        return records

    def model(self):
        model = self.col.models.by_name(MODEL)
        if model:
            if [field["name"] for field in model["flds"]] != FIELDS or len(model["tmpls"]) != 2:
                raise ValueError("The anki.auto note type was changed. Restore its fields/templates before capturing.")
            return model
        model = self.col.models.new(MODEL)
        for name in FIELDS:
            self.col.models.add_field(model, self.col.models.new_field(name))
        for name, question, answer in (("Vocabulary", "{{Front}}", "{{Back}}"),
                ("Example", "{{#ExampleFront}}{{ExampleFront}}{{/ExampleFront}}", "{{ExampleBack}}")):
            template = self.col.models.new_template(name)
            template["qfmt"], template["afmt"] = question, answer
            self.col.models.add_template(model, template)
        model["css"] = ".card { font-family: Arial,sans-serif; font-size:24px; text-align:center; color: #222; background:#fff; } .nightMode { color:#eee; background:#222; }"
        self.col.models.add(model)
        return model

    def existing_capture(self, request_id):
        if not isinstance(request_id, str) or len(request_id) > 100:
            raise ValueError("Invalid capture ID")
        # Search text is escaped and IDs are restricted by CaptureRequest at creation.
        safe = request_id.replace('"', '\\"').replace("\\", "\\\\")
        ids = self.col.find_notes(f'note:"{MODEL}" RequestId:"{safe}"')
        if not ids:
            return None
        note = self.col.get_note(ids[0])
        return self.note_result(note)

    def note_result(self, note):
        card_ids = note.card_ids()
        first = self.col.get_card(card_ids[0]) if card_ids else None
        return dict(note_id=note.id, card_ids=card_ids, card_count=len(card_ids),
            deck_name=self.col.decks.name(first.odid or first.did) if first else "",
            front=plain(note["Front"]), back=plain(note["Back"]),
            example_front=plain(note["ExampleFront"]), example_back=plain(note["ExampleBack"]),
            language=note["Language"], request_hash=note["RequestHash"])

    def add(self, data):
        request = CaptureRequest.from_dict(data["request"])
        content = CardContent.from_dict(data["content"], request)
        self.deck(request.deck_id)
        identity = request.to_dict()
        identity.pop("duplicate_ack", None)
        request_hash = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        existing = self.existing_capture(request.request_id)
        if existing:
            if existing["request_hash"] != request_hash:
                raise ValueError("This capture ID was already used for different content")
            return existing
        note = self.col.new_note(self.model())
        values = dict(Front=content.front, Back=content.back, ExampleFront=content.example_front,
            ExampleBack=content.example_back, SourceTerm=request.expression, Language=content.language,
            Context=request.context, SourceURL=request.source_url, SourceTitle=request.source_title,
            RequestId=request.request_id, RequestHash=request_hash)
        for name, value in values.items():
            note[name] = escape(value)
        note.tags = ["anki.auto"]
        self.col.add_note(note, request.deck_id)
        return self.note_result(note)

    def decks(self):
        counts = {}
        def walk(node):
            counts[node.deck_id] = dict(new=node.new_count, review=node.review_count, learning=node.learn_count)
            for child in node.children:
                walk(child)
        walk(self.col.sched.deck_due_tree())
        return dict(profile=self.profile, decks=[dict(id=row.id, name=row.name,
            counts=counts.get(row.id, {})) for row in self.col.decks.all_names_and_ids(include_filtered=False)])

    def dispatch(self, action, data):
        if action == "health":
            return dict(profile=self.profile, connected=True, recovery=bool(self.recovery),
                session=self.session.token if self.session else None)
        if action == "decks":
            return self.decks()
        if action == "matches":
            records = self.records(data["deck_id"])
            matches = find_matches(text(data["expression"], "expression", 1000, True), records)
            return dict(matches=matches, fingerprint=fingerprint(matches))
        if action == "capture_status":
            return {"capture": self.existing_capture(data["request_id"])}
        if action == "add":
            return self.add(data)
        if action == "media":
            name = text(data["name"], "filename", 500, True)
            if Path(name).name != name or "/" in name or "\\" in name or ":" in name:
                raise ValueError("Invalid media filename")
            directory = Path(self.col.media.dir()).resolve()
            path = (directory / name).resolve()
            if path.parent != directory or not path.is_file() or path.stat().st_size > 12_000_000:
                raise ValueError("Media unavailable or too large")
            kind = mimetypes.guess_type(name)[0] or "application/octet-stream"
            if not kind.startswith(("image/", "audio/")):
                raise ValueError("Only images and audio may be loaded")
            return dict(mime=kind, data=base64.b64encode(path.read_bytes()).decode("ascii"))
        if action == "edit":
            note = self.col.get_note(int(data["note_id"]))
            if data.get("modified") is not None and data["modified"] != note.mod:
                raise ValueError("The note changed in Anki; reopen it before editing")
            for key, value in data.get("fields", {}).items():
                if key not in dict(note.items()) or key in ("RequestId", "RequestHash"):
                    raise ValueError("Invalid editable field")
                note[key] = escape(text(value, key, 12000))
            self.col.update_note(note)
            return dict(note_id=note.id, modified=note.mod)
        if action == "review_start":
            if self.session:
                if data.get("resume"):
                    self.session.resume()
                    return self.session.current()
                raise ValueError("A review session is already active. Resume or end it first.")
            if self.recovery:
                if data.get("resume"):
                    self.session = ReviewSession.recover(self.col, self.recovery, self.state_path)
                    self.recovery = None
                    return self.session.current()
                raise ValueError("An interrupted session exists. Resume or end it first.")
            self.session = ReviewSession(self.col, self.state_path)
            return self.session.start(data["deck_ids"])
        if action == "review_current":
            if not self.session:
                return dict(active=False, recovery=bool(self.recovery))
            return self.session.current()
        if action == "review_action":
            if not self.session:
                raise ValueError("Review session ended or restarted; resume before continuing")
            return self.session.act(data)
        if action == "review_end":
            if self.session:
                result = self.session.end(data.get("session"))
                self.session = None
                return result
            if self.recovery:
                session = ReviewSession.recover(self.col, self.recovery, self.state_path)
                result = session.end(session.token)
                self.recovery = None
                return result
            return {"active": False}
        raise ValueError("Unsupported Anki operation")
