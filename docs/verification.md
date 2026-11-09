# Verification and handoff

## Automated evidence

- Anki 25.09.5’s installed Python, disposable collections only: `python -m unittest discover -s tests -v`. Covers optional sibling cards, exact home-deck matching, capture replay/recovery, authentication/origin pairing, custom-definition bypass, stale rating guards, native undo, daily ancestor budgets across repeated sessions, native-review switching, sibling burying, interrupted/day-rollover sessions, pending future learning, media references and collection switching during generation.
- `npm run check`: TypeScript, shortcut/controller tests, extension build, artifact checks. A DOM controller regression holds the next card’s image response and presses Space/3; no unseen card is rated. The artifact check verifies every entry page and referenced local resource, PDF worker/OCR assets, and the PDF.js text layer’s scaling/rotation rules.
- The packaged `.ankiaddon` was extracted into a temporary directory, compiled/imported with its bundled shared modules, and used against a disposable collection.
- Local Tesseract English/French data recognized a generated image as `Le chien attend devant la porte.` No network language downloads were used.
- Live subscription-authenticated Codex generated `the dog` / `le chien` with a French example, an idiom with literal meaning, and `…wanted to do the same thing…` / `…a voulu faire la même chose…`. Model: `gpt-5.6-luna`. The fragment result is normalized from a structured classification rather than relying on the model to retain punctuation.

## Chrome interaction checks still required

Computer-use verification was blocked by a host failure enforcing the current browser URL. These are **unverified**, not passing acceptance checks. No actual user collection was changed during testing.

1. Install the add-on, restart Anki, load the built unpacked extension and pair it. Verify both the Anki connection and Codex sign-in in Settings.
2. Enable capture on an article; select `chien` with surrounding French context. Confirm the marker, modal, deck selection, Send result and saved Anki note.
3. Repeat with Custom definition, then with Add example. Confirm one versus two cards, correct articles, and no generation in custom mode.
4. Capture an existing term, see the destination-deck alert, change the deck/term and confirm that the old acknowledgment cannot be reused.
5. Select text inside an embedded frame, near all viewport edges, and after scrolling a long article. Confirm the modal covers the top page and drafts survive closure.
6. Open a selectable PDF with scaled/rotated text, select a phrase and verify highlight alignment. Open an image PDF, extract/crop its page, correct OCR text and capture it. Test toolbar screenshot and Ctrl+V paste.
7. Start a mixed queue, reveal/rate with the keyboard and buttons, edit, undo, bury, mark, flag, replay audio, open native deck options, then end. Confirm home decks and native history.
8. Hold keys, type in the editor, focus buttons, open a second review tab and change Anki externally. Confirm no stale/unseen card can be rated. Interrupt and resume a session.
9. Disconnect the backend or exhaust/unavailable model access. Confirm the draft remains and custom entry/retry works after reconnecting.

## Fresh review and decisions

A read-only fresh reviewer examined commits `3516c4f..d48b861`. Four blockers were reproduced or traced: home daily counters, a delayed-render rating race, missing PDF.js 6 text-layer geometry, and pending learning reported as finished. All entered the fix pass with failing regressions first. The profile-switch path that the reviewer set aside was reproduced with backend/native save tests and guarded at both boundaries.

Other reviewed behavior stands: server-bound duplicate acknowledgments, sibling request replay, overlap deduplication and stale token/revision guards. Actual Chrome focus behavior, frame clipping, crop interaction and visual appearance remain in the manual checklist above. Generation has independent live smoke evidence; account billing controls remain outside the app. GitHub publishing depends on the user’s connection and is separate from code readiness.

## Rulings made during implementation

- Work directly in the explicitly requested fresh `anki.auto` folder on a feature branch. There were no product files to isolate; no main branch merge is performed.
- Use Python’s standard HTTP/SQLite libraries instead of FastAPI to avoid native installation friction on Windows ARM64. Request validation is maintained explicitly; supporting another framework later would require adaptation.
- Use the account-supported `gpt-5.6-luna` after the proposed `gpt-6-luna` was rejected. Model remains configurable; another account may require a different available model.
- Keep review recovery journals outside the Anki collection. Non-undoable collection-config writes clear native undo history.
- Existing card JavaScript, native TTS, video and MathJax remain unsupported. Basic HTML/CSS/local images/audio render in a scriptless iframe; complex decks should use desktop Anki.
- Deliver CMD/Python setup/start scripts instead of PowerShell helpers. This keeps startup usable under default Windows execution policy; prerequisites are still installed separately.
- Preserve Anki’s native filtered-deck per-answer counter deltas in the home lineage through undoable native deck updates. The native rating still supplies all intervals and review history. Regression tests cover undo and repeated sessions.
- Keep the feature branch and project in place while GitHub authentication is pending. The user explicitly requested publication, so no additional merge/PR approval menu is needed; no unknown remote is created or overwritten.

## Deferred minor findings

- Saving an edit after revealing a card returns that card to its question side.
- The PDF selection marker can remain at its old viewport position after scrolling/resizing; make a fresh selection to reposition it.

These do not affect saved scheduling history. They remain visible here rather than being silently treated as completed polish.
