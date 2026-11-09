import hashlib
import html
import json
import re
import unicodedata
from difflib import SequenceMatcher


def plain(value):
    return html.unescape(re.sub(r"<[^>]+>", " ", str(value))).strip()


def normalize(value):
    value = plain(value).casefold().replace("’", "'")
    value = "".join(c for c in unicodedata.normalize("NFKD", value) if not unicodedata.combining(c))
    value = re.sub(r"^(?:(?:le|la|les|un|une|des|the|an|a)\s+|l')", "", value)
    return " ".join(re.findall(r"\w+", value))


def find_matches(expression, records, limit=5):
    needle = normalize(expression)
    if not needle:
        return []
    matches = []
    for record in records:
        fields = record.get("texts", [record.get("term", ""), record.get("front", "")])
        score = 0.0
        for field in fields:
            candidate = normalize(field)
            if not candidate:
                continue
            ratio = 1.0 if candidate == needle else SequenceMatcher(None, needle, candidate).ratio()
            if min(len(needle), len(candidate)) <= 3 and candidate != needle:
                continue
            # Whole-word containment catches a phrase within a short expression, not arbitrary substrings.
            if len(needle.split()) > 1 and f" {needle} " in f" {candidate} ":
                ratio = max(ratio, .88)
            score = max(score, ratio)
        if score >= .8:
            matches.append(dict(note_id=record["note_id"], term=plain(record.get("term", "")),
                front=plain(record.get("front", "")), score=round(score, 3)))
    return sorted(matches, key=lambda row: (-row["score"], row["note_id"]))[:limit]


def fingerprint(records):
    encoded = json.dumps(sorted(records, key=lambda row: row["note_id"]), sort_keys=True,
        ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
