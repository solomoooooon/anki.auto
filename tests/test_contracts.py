import unittest

from anki_auto.contracts import CaptureRequest, CardContent, manual_content
from anki_auto.matching import find_matches, fingerprint


class ContractTests(unittest.TestCase):
    def request(self, **overrides):
        return CaptureRequest.from_dict(dict(request_id="capture-1", deck_id=7,
            expression="chien", language="fr", **overrides))

    def test_manual_definition_preserves_editable_back_and_example(self):
        request = CaptureRequest.from_dict(dict(request_id="c1", deck_id=7,
            expression="le chien", language="fr", custom_definition="the dog",
            add_example=True, example_front="The dog waits.", example_back="Le chien attend."))
        content = manual_content(request)
        self.assertEqual((content.front, content.back), ("the dog", "le chien"))
        self.assertEqual(content.example_back, "Le chien attend.")

    def test_custom_definition_requires_manual_example_pair(self):
        with self.assertRaisesRegex(ValueError, "example"):
            manual_content(self.request(custom_definition="the dog", add_example=True))

    def test_english_never_creates_example(self):
        request = CaptureRequest.from_dict(dict(request_id="c1", deck_id=7,
            expression="succour", language="en", custom_definition="help in distress", add_example=True))
        self.assertEqual(manual_content(request).example_front, "")

    def test_empty_and_oversized_capture_rejected(self):
        for expression in (" ", "x" * 1001):
            with self.subTest(expression=expression[:10]), self.assertRaises(ValueError):
                CaptureRequest.from_dict(dict(request_id="c1", deck_id=7, expression=expression))
        with self.assertRaises(ValueError):
            CaptureRequest.from_dict(dict(request_id="c1", deck_id=0, expression="chien"))

    def test_generation_requires_requested_french_example(self):
        with self.assertRaisesRegex(ValueError, "example"):
            CardContent.from_dict(dict(front="the dog", back="le chien", language="fr",
                example_front="", example_back=""), self.request(add_example=True))

    def test_generated_content_is_plain_text(self):
        with self.assertRaises(ValueError):
            CardContent.from_dict(dict(front="<script>alert(1)</script>", back="le chien",
                language="fr", example_front="", example_back=""), self.request())


class MatchingTests(unittest.TestCase):
    def test_article_accent_html_and_phrase_variations(self):
        records = [dict(note_id=1, term="<b>le chien</b>", front="the dog"),
            dict(note_id=2, term="la même chose", front="the same thing"),
            dict(note_id=3, term="chat", front="the cat")]
        self.assertEqual(find_matches("chien", records)[0]["note_id"], 1)
        self.assertEqual(find_matches("meme chose", records)[0]["note_id"], 2)
        self.assertEqual(find_matches("xy", records), [])

    def test_fingerprint_changes_when_matching_content_changes(self):
        first = [dict(note_id=1, term="le chien", front="the dog")]
        second = [dict(note_id=1, term="le chien", front="a male dog")]
        self.assertNotEqual(fingerprint(first), fingerprint(second))
        self.assertEqual(fingerprint(first), fingerprint(list(reversed(first))))


if __name__ == "__main__":
    unittest.main()
