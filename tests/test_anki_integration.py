"""Run with an Anki-installed Python, against disposable collections only."""
import tempfile
from pathlib import Path
import unittest

try:
    from anki.collection import Collection
except ImportError:
    Collection = None

if Collection:
    from anki_addon.core import AnkiService


@unittest.skipUnless(Collection, "Run with Anki's Python for native integration tests")
class AnkiIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.col = Collection(str(Path(self.temp.name) / "test.anki2"))
        self.service = AnkiService(self.col, "Disposable test")
        self.french = self.col.decks.id("French")
        self.english = self.col.decks.id("English")

    def tearDown(self):
        self.col.close()
        self.temp.cleanup()

    def add(self, request_id="c1", deck=None, example=False):
        return self.service.dispatch("add", {"request":dict(request_id=request_id,
            deck_id=deck or self.french, expression="chien", language="fr", add_example=example),
            "content":dict(front="the dog", back="le chien", language="fr",
                example_front="The dog waits." if example else "",
                example_back="Le chien attend." if example else "")})

    def test_optional_sibling_and_request_replay(self):
        first = self.add(example=True)
        self.assertEqual(len(first["card_ids"]), 2)
        second = self.add(example=True)
        self.assertEqual(second["note_id"], first["note_id"])
        self.assertEqual(self.col.db.scalar("select count(*) from notes"), 1)
        third = self.add("c2")
        self.assertEqual(len(third["card_ids"]), 1)

    def test_duplicate_scope_uses_exact_home_deck(self):
        self.add(deck=self.french)
        child = self.col.decks.id("English::Child")
        self.add("c2", child)
        self.assertEqual(self.service.dispatch("matches",dict(deck_id=self.english, expression="chien"))["matches"], [])
        self.assertEqual(len(self.service.dispatch("matches",dict(deck_id=self.french, expression="chien"))["matches"]), 1)

    def test_native_rating_replay_stale_guard_and_home_restoration(self):
        self.add("c1", self.french)
        self.add("c2", self.english)
        card = self.service.dispatch("review_start", dict(deck_ids=[self.french,self.english]))
        self.assertTrue(card["card_id"])
        original = self.col.get_card(card["card_id"])
        self.assertIn(original.odid or original.did, [self.french,self.english])
        payload = dict(session=card["session"],revision=card["revision"],card_id=card["card_id"],
            action_id="rate-1",action="rate",rating=3,elapsed_ms=2000)
        after = self.service.dispatch("review_action",payload)
        self.assertEqual(self.col.db.scalar("select count(*) from revlog"), 1)
        self.assertEqual(self.service.dispatch("review_action",payload), after)
        with self.assertRaisesRegex(ValueError,"stale|changed"):
            self.service.dispatch("review_action",dict(payload,action_id="rate-2"))
        self.service.dispatch("review_end",dict(session=after["session"]))
        self.assertEqual(self.col.db.scalar("select count(*) from cards where odid != 0"), 0)
        self.assertEqual(self.col.db.scalar("select count(*) from revlog"), 1)

    def test_original_parent_daily_budget_preserved(self):
        parent=self.col.decks.id("Languages")
        a=self.col.decks.id("Languages::French")
        b=self.col.decks.id("Languages::Other")
        config=self.col.decks.config_dict_for_deck_id(parent)
        config["new"]["perDay"]=1
        self.col.decks.update_config(config)
        for i in range(3):
            self.add(f"a{i}", a); self.add(f"b{i}", b)
        card=self.service.dispatch("review_start",dict(deck_ids=[parent,a,b]))
        self.assertEqual(card["counts"]["new"],1)
        self.assertEqual(self.col.db.scalar("select count(*) from cards where odid != 0"),1)
        self.service.dispatch("review_end",dict(session=card["session"]))

    def test_native_undo_restores_review(self):
        self.add()
        before=self.service.dispatch("review_start",dict(deck_ids=[self.french]))
        after=self.service.dispatch("review_action",dict(session=before["session"],revision=before["revision"],
            card_id=before["card_id"],action_id="r1",action="rate",rating=3,elapsed_ms=500))
        undone=self.service.dispatch("review_action",dict(session=after["session"],revision=after["revision"],
            card_id=after.get("card_id"),action_id="u1",action="undo"))
        self.assertEqual(undone["card_id"],before["card_id"])
        self.assertEqual(self.col.db.scalar("select count(*) from revlog"),0)

    def test_recovery_rotates_session_and_rejects_pre_restart_rating(self):
        self.add()
        before=self.service.dispatch("review_start",dict(deck_ids=[self.french]))
        recovered=AnkiService(self.col,"Disposable test")
        after=recovered.dispatch("review_start",dict(resume=True))
        self.assertNotEqual(after["session"],before["session"])
        with self.assertRaisesRegex(ValueError,"changed"):
            recovered.dispatch("review_action",dict(session=before["session"],revision=before["revision"],
                card_id=before["card_id"],action_id="old",action="rate",rating=3))
        self.assertEqual(self.col.db.scalar("select count(*) from revlog"),0)
        recovered.dispatch("review_end",dict(session=after["session"]))

    def test_invalid_rating_duration_does_not_poison_session(self):
        self.add()
        before=self.service.dispatch("review_start",dict(deck_ids=[self.french]))
        with self.assertRaises(ValueError):
            self.service.dispatch("review_action",dict(session=before["session"],revision=before["revision"],
                card_id=before["card_id"],action_id="bad",action="rate",rating=3,elapsed_ms="bad"))
        self.assertEqual(self.service.dispatch("review_current",{})["card_id"],before["card_id"])

    def test_native_sibling_bury_is_preserved(self):
        config=self.col.decks.config_dict_for_deck_id(self.french)
        config["new"]["bury"]=True
        self.col.decks.update_config(config)
        added=self.add(example=True)
        before=self.service.dispatch("review_start",dict(deck_ids=[self.french]))
        self.service.dispatch("review_action",dict(session=before["session"],revision=before["revision"],
            card_id=before["card_id"],action_id="bury-sibling",action="rate",rating=4))
        sibling=next(cid for cid in added["card_ids"] if cid != before["card_id"])
        self.assertEqual(self.col.get_card(sibling).queue,-2)

    def test_failed_start_does_not_leave_a_phantom_session(self):
        self.add()
        with self.assertRaises(ValueError):
            self.service.dispatch("review_start",dict(deck_ids=[999999]))
        self.assertFalse(self.service.dispatch("review_current",{})["active"])
        self.assertTrue(self.service.dispatch("review_start",dict(deck_ids=[self.french]))["card_id"])

    def test_native_audio_references_are_exposed(self):
        result=self.add()
        note=self.col.get_note(result["note_id"])
        note["Front"] += " [sound:dog.mp3]"
        self.col.update_note(note)
        card=self.service.dispatch("review_start",dict(deck_ids=[self.french]))
        self.assertEqual(card["question_audio"],["dog.mp3"])

    def test_old_day_recovery_requires_a_new_queue(self):
        import json
        self.add()
        self.service.dispatch("review_start",dict(deck_ids=[self.french]))
        path=self.service.state_path
        state=json.loads(path.read_text());state["day"]-=1;path.write_text(json.dumps(state))
        recovered=AnkiService(self.col,"Disposable test")
        with self.assertRaisesRegex(ValueError,"day changed"):
            recovered.dispatch("review_start",dict(resume=True))
        recovered.dispatch("review_end",{})
        self.assertEqual(self.col.db.scalar("select count(*) from cards where odid != 0"),0)


if __name__ == "__main__":
    unittest.main()
