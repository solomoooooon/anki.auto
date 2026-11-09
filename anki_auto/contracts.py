from dataclasses import asdict, dataclass
import re


def text(value, name, limit, required=False):
    if not isinstance(value, str):
        raise ValueError(f"{name} must be text")
    value = value.strip()
    if len(value) > limit or (required and not value):
        raise ValueError(f"{name} must contain {'1' if required else '0'}–{limit} characters")
    return value


@dataclass(frozen=True)
class CaptureRequest:
    request_id: str
    deck_id: int
    expression: str
    language: str = "auto"
    detected_language: str = ""
    context: str = ""
    custom_definition: str = ""
    add_example: bool = False
    example_front: str = ""
    example_back: str = ""
    source_url: str = ""
    source_title: str = ""
    duplicate_ack: str = ""
    collection_id: str = ""

    @classmethod
    def from_dict(cls, data):
        if not isinstance(data, dict):
            raise ValueError("Expected a capture object")
        allowed = cls.__dataclass_fields__
        values = {key: value for key, value in data.items() if key in allowed}
        for name, limit, required in (("request_id", 100, True), ("expression", 1000, True),
                ("context", 8000, False), ("custom_definition", 4000, False),
                ("example_front", 2000, False), ("example_back", 2000, False),
                ("source_url", 4000, False), ("source_title", 500, False), ("duplicate_ack", 128, False), ("collection_id",128,False)):
            values[name] = text(data.get(name, ""), name, limit, required)
        if not re.fullmatch(r"[A-Za-z0-9_-]+", values["request_id"]):
            raise ValueError("Invalid request_id")
        deck_id = data.get("deck_id")
        if not isinstance(deck_id, int) or isinstance(deck_id, bool) or deck_id <= 0:
            raise ValueError("Choose a destination deck")
        if data.get("language", "auto") not in ("auto", "en", "fr"):
            raise ValueError("Unsupported language")
        if data.get("detected_language", "") not in ("", "en", "fr"):
            raise ValueError("Invalid detected language")
        if not isinstance(data.get("add_example", False), bool):
            raise ValueError("add_example must be a checkbox value")
        return cls(**values)

    def to_dict(self):
        return asdict(self)


@dataclass(frozen=True)
class CardContent:
    front: str
    back: str
    language: str
    example_front: str = ""
    example_back: str = ""

    @classmethod
    def from_dict(cls, data, request):
        if not isinstance(data, dict):
            raise ValueError("Definition did not return an object")
        language = data.get("language")
        if language not in ("en", "fr"):
            raise ValueError("Definition language must be English or French")
        if request.language != "auto" and language != request.language:
            raise ValueError("Definition returned the wrong source language")
        values = {name: text(data.get(name, ""), name, limit, required) for name, limit, required in
            (("front", 4000, True), ("back", 2000, True), ("example_front", 2000, False), ("example_back", 2000, False))}
        if any(re.search(r"<\s*/?\w+[^>]*>", value) for value in values.values()):
            raise ValueError("Definition must be plain text")
        if request.add_example and language == "fr":
            if not values["example_front"] or not values["example_back"]:
                raise ValueError("Both example sentences are required")
        else:
            values["example_front"] = values["example_back"] = ""
        if data.get("fragment") is True:
            for side in ("front", "back"):
                values[side] = "…" + values[side].strip(" .…") + "…"
        return cls(language=language, **values)

    def to_dict(self):
        return asdict(self)


def manual_content(request):
    if not request.custom_definition:
        raise ValueError("A custom definition is required")
    language = request.language if request.language != "auto" else request.detected_language
    if not language:
        raise ValueError("Choose English or French for a custom definition")
    # User-entered content is escaped at the Anki boundary, not interpreted as HTML.
    data = dict(front=request.custom_definition, back=request.expression, language=language,
        example_front=request.example_front, example_back=request.example_back)
    return CardContent.from_dict(data, request)


CONTENT_SCHEMA = {"type": "object", "properties": {
    **{key: {"type": "string"} for key in ("front", "back", "language", "example_front", "example_back")},
    "fragment": {"type":"boolean"}},
    "required": ["front", "back", "language", "example_front", "example_back", "fragment"], "additionalProperties": False}
