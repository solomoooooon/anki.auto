"""Native scheduler operations; never synthesize intervals or write revlog rows."""
import html
import json
import math
import secrets
import time
from pathlib import Path

from anki.cards import Card
from anki.scheduler.v3 import CardAnswer


class ReviewSession:
    def __init__(self, col, state_path):
        self.col = col
        self.token = secrets.token_urlsafe(24)
        self.revision = 0
        self.deck_id = None
        self.previous_deck = col.decks.get_current_id()
        self.expected_step = col.undo_status().last_step
        self.current_id = None
        self.current_card = None
        self.states = None
        self.started = time.monotonic()
        self.undo_steps = []
        self.replays = {}
        self.previous_card = None
        self.state_path = Path(state_path)
        self.day = col.sched.today

    def persist(self, pending=None):
        state = dict(deck_id=self.deck_id, token=self.token,
            previous_deck=self.previous_deck, revision=self.revision, pending=pending,
            day=self.day, replay=list(self.replays.items())[-32:])
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.state_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(state), encoding="utf-8")
        temporary.replace(self.state_path)

    @classmethod
    def recover(cls, col, data, state_path):
        session = cls(col, state_path)
        session.deck_id = data["deck_id"]
        if not col.decks.is_filtered(session.deck_id) or session.deck_id != col.get_config("ankiAutoReviewDeck"):
            raise ValueError("The interrupted study deck is unavailable; open Anki to inspect it")
        session.previous_deck = data.get("previous_deck", 1)
        session.day = data.get("day", col.sched.today)
        session.revision = data.get("revision", 0) + 1
        session.replays = dict(data.get("replay", []))
        # New token deliberately rejects requests sent before an add-on restart, including a pending write.
        session.resume()
        return session

    def resume(self):
        self.col.decks.set_current(self.deck_id)
        self.expected_step = self.col.undo_status().last_step
        self.revision += 1
        self.current_id = None
        self.undo_steps = []
        self.persist()

    def guard(self):
        if self.col.decks.get_current_id() != self.deck_id or self.col.undo_status().last_step != self.expected_step:
            raise ValueError("Anki changed outside this session. Resume to refresh before reviewing.")
        if self.day != self.col.sched.today:
            raise ValueError("The Anki day changed. End this session and start a new queue.")

    def gather(self, deck_ids):
        if not isinstance(deck_ids, list) or not deck_ids or len(deck_ids) > 500:
            raise ValueError("Choose at least one deck")
        selected = set()
        for did in deck_ids:
            if not isinstance(did, int) or isinstance(did, bool):
                raise ValueError("Invalid deck selection")
            deck = self.col.decks.get_legacy(did)
            if not deck or deck["dyn"]:
                raise ValueError("Only normal decks can be reviewed")
            selected.update(self.col.decks.deck_and_child_ids(did))
        roots = [did for did in selected if not any(parent["id"] in selected for parent in self.col.decks.parents(did))]
        limits = {}
        def walk(node):
            limits[node.deck_id] = [node.new_count, node.review_count]
            for child in node.children:
                walk(child)
        walk(self.col.sched.deck_due_tree())
        candidates, seen = [], set()
        try:
            for did in sorted(roots):
                self.col.decks.set_current(did)
                for queued in self.col.sched.get_queued_cards(fetch_limit=10000).cards:
                    card = self.col.get_card(queued.card.id)
                    if card.id in seen or card.did not in selected or card.odid:
                        continue
                    lineage = [card.did] + [deck["id"] for deck in self.col.decks.parents(card.did)]
                    index = 0 if card.queue == 0 else (1 if card.queue == 2 else None)
                    if index is not None:
                        if any(limits.get(ancestor, [0, 0])[index] <= 0 for ancestor in lineage):
                            continue
                        for ancestor in lineage:
                            limits[ancestor][index] -= 1
                    candidates.append(card.id)
                    seen.add(card.id)
        finally:
            self.col.decks.set_current(self.previous_deck)
        return candidates

    def start(self, deck_ids):
        candidates = self.gather(deck_ids)
        tracked = self.col.get_config("ankiAutoReviewDeck", 0)
        if tracked and self.col.decks.get_legacy(tracked) and not self.col.decks.is_filtered(tracked):
            raise ValueError("The managed review deck was changed into a normal deck")
        if tracked and not self.col.decks.get_legacy(tracked):
            tracked = 0
        name = "anki.auto Review (managed)"
        collision = self.col.decks.id_for_name(name)
        if collision and collision != tracked:
            raise ValueError("A user deck uses the reserved review name. Rename it in Anki first.")
        filtered = self.col.sched.get_or_create_filtered_deck(tracked)
        filtered.name = name
        filtered.allow_empty = True
        filtered.config.reschedule = True
        del filtered.config.search_terms[:]
        query = "cid:" + ",".join(map(str, candidates)) if candidates else "cid:0"
        filtered.config.search_terms.add(search=query, limit=max(1, len(candidates)), order=1)
        result = self.col.sched.add_or_update_filtered_deck(filtered)
        self.deck_id = result.id
        self.col.set_config("ankiAutoReviewDeck", self.deck_id)
        self.col.sched.rebuild_filtered_deck(self.deck_id)
        self.col.decks.set_current(self.deck_id)
        self.expected_step = self.col.undo_status().last_step
        self.persist()
        return self.current()

    def current(self):
        self.guard()
        queued = self.col.sched.get_queued_cards()
        counts = dict(new=queued.new_count, learning=queued.learning_count, review=queued.review_count)
        base = dict(active=True, session=self.token, revision=self.revision, counts=counts,
            can_undo=bool(self.undo_steps), space_rates=True)
        if not queued.cards:
            self.current_id = None
            self.current_card = None
            info = self.col.sched.congratulations_info()
            return dict(base, card_id=None, finished=not counts["learning"],
                next_due=getattr(info, "next_learn_due", 0))
        item = queued.cards[0]
        card = Card(self.col, backend_card=item.card)
        if card.id != self.current_id:
            card.start_timer()
            self.current_card, self.started = card, time.monotonic()
            self.current_id = card.id
        self.states = item.states
        note = card.note()
        language = note["Language"] if "Language" in note else ""
        return dict(base, card_id=card.id, note_id=note.id, modified=note.mod,
            front=card.question(), back=card.answer(), css=note.note_type()["css"],
            home_deck=self.col.decks.name(card.odid or card.did), language=language,
            fields=dict(note.items()), intervals=list(self.col.sched.describe_next_states(item.states)),
            question_audio=[tag.filename for tag in card.question_av_tags() if hasattr(tag,"filename")],
            answer_audio=[tag.filename for tag in card.answer_av_tags() if hasattr(tag,"filename")],
            marked="marked" in note.tags, flag=card.user_flag())

    def act(self, data):
        if data.get("session") != self.token:
            raise ValueError("Review session changed; refresh before continuing")
        action_id = data.get("action_id")
        if not isinstance(action_id, str) or not 1 <= len(action_id) <= 100:
            raise ValueError("Missing review action ID")
        signature = json.dumps({k: v for k, v in data.items() if k != "action_id"}, sort_keys=True)
        if action_id in self.replays:
            previous = self.replays[action_id]
            if previous[0] != signature:
                raise ValueError("Action ID was already used with different content")
            return previous[1]
        self.guard()
        if data.get("revision") != self.revision or data.get("card_id") != self.current_id:
            raise ValueError("This review request is stale; refresh the current card")
        action = data.get("action")
        if action == "undo":
            if not self.undo_steps or self.col.undo_status().last_step != self.undo_steps[-1]:
                raise ValueError("The latest Anki action cannot safely be undone here")
            self.persist(pending=action_id)
            self.col.undo()
            self.undo_steps.pop()
        else:
            if not self.current_card:
                raise ValueError("There is no current card")
            card, note = self.current_card, self.current_card.note()
            if action == "rate" and (type(data.get("rating")) is not int or data["rating"] not in (1, 2, 3, 4)):
                raise ValueError("Rating must be 1, 2, 3 or 4")
            if action not in ("rate", "bury_card", "bury_note", "suspend_card", "suspend_note", "mark", "flag", "edit"):
                raise ValueError("Unsupported review action")
            elapsed = data.get("elapsed_ms", int((time.monotonic()-self.started)*1000))
            if action == "rate" and (type(elapsed) not in (int, float) or not math.isfinite(elapsed)):
                raise ValueError("Invalid review duration")
            if action == "flag" and (type(data.get("flag")) is not int or not 0 <= data["flag"] <= 7):
                raise ValueError("Invalid flag")
            if action == "edit":
                if not isinstance(data.get("fields"), dict):
                    raise ValueError("Invalid note fields")
                for name, value in data["fields"].items():
                    if name not in dict(note.items()) or name in ("RequestId", "RequestHash") or not isinstance(value, str) or len(value)>12000:
                        raise ValueError("Invalid note field")
            self.persist(pending=action_id)
            marker = self.col.add_custom_undo_entry("anki.auto " + action)
            if action == "rate":
                rating = (CardAnswer.AGAIN, CardAnswer.HARD, CardAnswer.GOOD, CardAnswer.EASY)[data["rating"] - 1]
                answer = self.col.sched.build_answer(card=card, states=self.states, rating=rating)
                answer.milliseconds_taken = min(max(0, int(elapsed)), card.time_limit())
                self.col.sched.answer_card(answer)
                self.previous_card = card.id
            elif action in ("bury_card", "suspend_card"):
                getattr(self.col.sched, action.replace("_card", "_cards"))([card.id])
            elif action in ("bury_note", "suspend_note"):
                getattr(self.col.sched, action.replace("_note", "_notes"))([note.id])
            elif action == "mark":
                if "marked" in note.tags:
                    note.tags.remove("marked")
                else:
                    note.tags.append("marked")
                self.col.update_note(note)
            elif action == "flag":
                flag = data.get("flag", 0)
                if type(flag) is not int or not 0 <= flag <= 7:
                    raise ValueError("Invalid flag")
                self.col.set_user_flag_for_cards(flag, [card.id])
            elif action == "edit":
                for name, value in data.get("fields", {}).items():
                    if name not in dict(note.items()) or name in ("RequestId", "RequestHash") or not isinstance(value, str) or len(value)>12000:
                        raise ValueError("Invalid note field")
                    note[name] = html.escape(value).replace("\n", "<br>")
                self.col.update_note(note)
            self.col.merge_undo_entries(marker)
            self.undo_steps.append(self.col.undo_status().last_step)
        self.revision += 1
        self.expected_step = self.col.undo_status().last_step
        self.current_id = None
        # Save the day/token before reading the next native snapshot.
        self.persist()
        result = self.current()
        self.replays[action_id] = (signature, result)
        self.replays = dict(list(self.replays.items())[-32:])
        self.persist()
        return result

    def end(self, token):
        if token != self.token:
            raise ValueError("Review session changed")
        if self.deck_id == self.col.get_config("ankiAutoReviewDeck") and self.col.decks.is_filtered(self.deck_id):
            self.col.sched.empty_filtered_deck(self.deck_id)
        if self.col.decks.get_legacy(self.previous_deck):
            self.col.decks.set_current(self.previous_deck)
        self.state_path.unlink(missing_ok=True)
        return dict(active=False)
