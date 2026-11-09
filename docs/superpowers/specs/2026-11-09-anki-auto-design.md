# anki.auto — design for approval

Date: 2026-11-09
Status: Proposed design; product implementation has not started.

## Intent

A personal Windows application for turning unfamiliar English and French expressions encountered while reading in Chrome into concise Anki cards, and reviewing selected Anki decks together in a browser. Remove the repetitive lookup-and-paste work while keeping Anki as the owner of cards, review history, and scheduling.

All source, scripts, documentation, mockups, and distributable files live under `C:\Users\solly\Projects\anki.auto`. Installing the Anki add-on necessarily copies its package into Anki's add-ons directory. Per-installation secrets and operational state live outside the shareable source folder, in `%LOCALAPPDATA%\anki.auto`.

## Confirmed requirements

- Windows only; local, personal use. A friend can copy the project, install it, and use their own Anki collection and ChatGPT login.
- Python backend, JS/TS Chrome extension and browser frontend.
- Capture mode can be activated. Selecting text shows a checkmark at the upper-right of the selection. Clicking it opens a modal.
- The modal offers destination-deck selection and an optional custom definition. Send generates a contextual definition/translation and saves automatically. A supplied custom definition skips the model/dictionary call.
- The modal includes an **Add example** checkbox for foreign-language words/phrases. Selecting it adds a separate card with a natural English example sentence on the front and its French translation, containing the selected word/phrase, on the back. Disable this option for English vocabulary.
- Before generation or saving, search for near matches in the destination deck only. Display existing matches near the capture UI and require Continue anyway or Cancel. Do not silently discard duplicates.
- English definitions/meanings go on the front; the original word/expression goes on the back. French nouns include articles. French expressions use an English front.
- Sentence fragments use ellipses. Idioms include their actual English meaning and a brief literal translation. Keep both sides concise.
- Support webpages and PDFs, including screenshot-to-text extraction for scanned/image PDFs. Screenshots only supply text; they never appear on cards.
- Browser review combines selected decks into one mixed queue. Ratings update the original cards through Anki.
- The browser review page preserves Anki's relevant review shortcuts, including the 1–4 ratings and Space/Enter behavior, rather than inventing a different keyboard workflow.
- Use one bundled custom Anki add-on rather than AnkiConnect plus another add-on.

## Approaches considered

1. **Bundled Anki bridge — selected by the user.** Python backend plus a small custom Python add-on. One add-on to install and direct access to native scheduling. We maintain compatibility with supported Anki versions.
2. **AnkiConnect plus a companion add-on.** Reuses general CRUD APIs but still needs a scheduler bridge for the combined queue. More components to install and coordinate. Rejected in favor of the single bridge.

Definition generation can use a supported ChatGPT sign-in integration or the locally installed Codex CLI. **Proposed default: Codex CLI**, following the user's suggested local-prompt workflow. It is already installed and reports ChatGPT authentication on this computer. A separate ChatGPT window need not remain open. Gemini and paid API-key providers are out of the first version.

## Proposed defaults to approve

These details are builder proposals, not requirements previously supplied by the user:

- Start capture mode off; activating it applies to ordinary permitted pages until switched off. Retain the last destination deck locally.
- Language selector: Auto, English, French. Infer from nearby text, with a manual override for ambiguous words. Use a small language/deck cue in review chrome so an English prompt has an unambiguous response language; leave card content uncluttered.
- PDF selection uses a bundled reader opened explicitly through **Open PDF in anki.auto**. The native Chrome PDF viewer remains usable through screenshot capture. Do not replace the browser's default PDF handler globally.
- OCR runs locally with bundled English/French OCR assets, not a remote vision request. Proposed implementation: Tesseract.js in an extension-owned page/worker. No runtime CDN dependency.
- New captures use a dedicated **anki.auto Vocabulary** note type with one vocabulary card and an optional example card. Existing user note types are not modified.
- Review supports basic/cloze cards, rendered HTML/CSS, ordinary images, and audio. Arbitrary JavaScript-driven card templates are outside v1; offer Open in Anki when unsupported. Keyboard behavior is specified below.
- Review includes due/relearning cards and each selected deck's eligible new-card allowance; preserve native daily budgets rather than gathering all new cards. No timer rotation or separate deck-by-deck mode in v1.
- After saving, show the actual front/back and an Edit action for that new note. No second approval step for generated definitions.
- Developer setup is acceptable: install Python and Node.js, run setup, load the unpacked extension once, install the packaged add-on, and start the local launcher. No hosted account, Windows service, or polished installer required.

## Capture workflow

1. On an ordinary permitted page, observe actual user selections only while capture is active. Support normal DOM text, editable text, and permitted frames where Chrome exposes selection. Ignore passwords and the extension's own controls.
2. Position the checkmark beside the selection's upper-right, clamped inside the viewport. Preserve the selection on click and move the marker as needed on scrolling. Escape dismisses it.
3. Open the modal with editable expression/back text, language, deck selector, optional custom definition/front text, an **Add example** checkbox, and an expandable context field. Capture the surrounding sentence or short passage, capped in size. Source title/URL are metadata, not visible card text. Proposed checkbox default: unchecked for each capture.
4. Immediately check the expression against the currently selected destination deck. The initial check uses the remembered deck. Editing the expression or changing deck invalidates the result and reruns the check. Send waits for the current result.
5. If near matches exist, show a compact alert adjacent to the modal with the existing expression, meaning, and deck. Continue anyway acknowledges only this expression/deck combination; Cancel returns to the editable draft. The draft must not disappear.
6. Send with a custom definition skips all remote generation and dictionary calls. The supplied front and editable back are saved as provided. In this path, the user can add an article directly to the back; do not secretly invoke a model to infer one.
7. Otherwise, send the expression, chosen language, and bounded nearby context to the Codex definition worker. Validate its structured response, then add the note. The model returns content only; it never creates cards or chooses destinations.
8. Disable repeated Send while running. Success shows the saved card and deck; errors retain the draft and expose Retry. Use a stable request ID so a lost response/retry cannot add the same capture twice. An intentional second capture can create another meaning after confirmation.

### Near matching

Use local deterministic matching, never a model call. Query only cards whose home deck is exactly the selected destination; a parent deck does not implicitly include children for duplicate checks. Resolve cards temporarily held in our study deck back to their home deck.

Compare the stored source term and visible back for our note type. For existing user note types, compare normalized text fields on both sides to accommodate different card directions. Strip HTML, normalize whitespace, apostrophes, Unicode, case, and punctuation; use accent/article-insensitive comparisons as additional candidates, without altering card text. Combine exact matching, phrase overlap, and conservative fuzzy similarity. Show a short ranked list, including exact matches; never auto-merge or overwrite a note. Thresholds and indexing strategy are left to the builder and must be covered by representative examples.

Duplicate acknowledgment must be checked again at the save boundary if the expression, deck, or matching collection content changed. A stale browser result cannot bypass the gate.

### Text, PDFs, and screenshots

The coverage promise is accessible text inside Chrome, with an image capture fallback where direct selection is unavailable. Browser security prevents inserting controls into every page or viewer.

- Ordinary articles: selection plus surrounding passage.
- Text PDFs: extension-owned PDF.js reader, with the same selection and modal flow. Accept an explicit local PDF file or fetch a user-selected PDF URL where access permits. If an authenticated URL cannot be fetched, offer local file opening or screenshot capture; do not bypass access controls.
- Scanned PDFs, canvas readers, and otherwise inaccessible text: the toolbar's Screenshot action captures the visible tab, then opens an extension-owned crop editor. Cropping happens on that captured image, so it works even where page injection is blocked. Only the selected crop is sent to local OCR.
- OCR returns editable text. Let the user select a term from the extracted passage, retaining the rest as optional context, then use the normal modal. Allow pasting an existing screenshot into the capture editor as a convenience.
- Local files require Chrome's Allow access to file URLs setting. Document this during setup. Multi-page/full-desktop capture is outside v1.
- Keep screenshots in memory or temporary local storage only for OCR; discard them afterward. Store no image in Anki. OCR must remain usable without Codex so custom-definition captures work offline.

## Card content contract

| Captured expression | Front | Back |
| --- | --- | --- |
| `chien` | the dog | le chien |
| `a voulu faire la même chose` | …wanted to do the same thing… | …a voulu faire la même chose… |
| `avoir le cafard` | to feel down (literally: to have the cockroach) | avoir le cafard |
| English word | concise English definition of the sense used | original word |

Choose the sense that fits the supplied passage. For French nouns, supply the appropriate definite article and preserve number where meaningful; include gender when an elided/plural article conceals it, using a compact `(m.)`/`(f.)` on the back. Normalize a noun or ordinary verb lookup to its dictionary form when context does not require the inflected form; preserve the selected tense/person for fragments and phrases. These normalization details are proposed defaults.

Do not add example paragraphs, headings, phonetics, pronunciation audio, or extra reverse cards. Interpret ellipses as a fragment marker rather than inventing missing text. When meaning is genuinely ambiguous, return a request for more context rather than fabricating a confident sense. Render model text as text, never executable HTML.

Hidden metadata includes raw source term, source language, context, source URL/title, and capture request ID. Only Front and Back appear on the vocabulary card; optional ExampleFront/ExampleBack fields appear only on its example card.

### Optional example card

The Add example control requests one additional, separately reviewable card in the same destination deck, for French words/phrases only in v1. It must not crowd an example onto the vocabulary card. The front is a short, natural sentence in English; the back is the French translation using the selected expression in the same sense as the vocabulary card. Inflect the expression as needed for a grammatical sentence. For example, capturing `chien` can add **The dog is waiting near the gate.** / **Le chien attend près du portail.** Do not produce a cloze exercise, grammar explanation, or an English-vocabulary example card. With Auto language, resolve the language before committing a requested example; if the term is English, save only the vocabulary card and clearly state why no example was added.

Proposed handling: with automatic generation, request vocabulary and example content together in one structured model response. With a custom definition, keep the zero-model-call guarantee and provide editable example front/back inputs instead. Validate both requested cards before writing one note, with a stable capture request ID so retry cannot create a second copy. Commit through Anki and report whether one or two cards were added. The existing duplicate gate still applies before generating/saving the capture.

Proposed note structure: use two card templates on the same note, with the example template conditional on nonempty ExampleFront/ExampleBack. The result is two separately reviewable cards when opted in, and one card otherwise. This preserves Anki's native sibling-burying behavior and makes creation/retries simpler than a two-note write. The example card shows only its sentence pair. A failed example generation must not silently drop the requested example; retain the draft and offer Retry or uncheck Add example. English captures always remain one-card captures.

## Browser review

The review page is an extension-owned browser tab, not a wrapper that scrapes ankiweb.net. It talks to this computer's Anki through our backend and add-on.

1. Display the active Anki profile and a deck checklist with due/new counts. Remember the selection. Selecting a parent for review includes descendants; deduplicate overlapping selections.
2. Start one session for the selected deck union. Prepare a reserved temporary filtered deck, using Anki's native rescheduling behavior and preserving each card's original home-deck link. It may appear in Anki's deck list while in use; no permanent user-deck rearrangement occurs.
3. Before gathering cards, enforce the original decks' remaining daily new/review budgets, including ancestor limits and sibling overlap. Filtered decks bypass normal gathering limits, so these must be explicitly preserved by the bridge. Gather native eligible cards once per session, with a bounded budget; do not continuously rebuild the filtered deck on every answer.
4. Mix eligible review cards across source decks. Native learning/relearning timing takes precedence over random order. New cards use the eligible budgets and native session settings. Suspended, buried, future review cards, and cards already in another filtered deck are excluded.
5. Read each card and its available next states from Anki's scheduler. Reveal the answer, then offer Again/Hard/Good/Easy with native interval labels. Send the rating and elapsed review time to the add-on, which applies the native answer operation and returns the next card.
6. Do not write scheduling fields or review-log rows directly and do not implement FSRS/SM-2 in Python or TypeScript. Anki determines whether a card is due again today, tomorrow, or later.
7. Serialize review mutations. A session token, current-card identifier, and monotonically increasing revision reject stale tabs, double-click ratings, and out-of-order requests. An accepted request replay returns its original result instead of recording another review.
8. Only one browser review session controls Anki at a time. If the user changes profile or reviews/edits incompatibly in desktop Anki, stop and ask the user to resume the browser session; never rate an unexpected card.
9. Provide End session and a safe Undo last rating action. Undo is available only while the app can prove the latest undoable action belongs to this session. Keep an interrupted session recoverable; a subsequent connection offers Resume or End. Ending empties our temporary deck through Anki, returning remaining cards without resetting their progress. Never delete user decks.
10. If no cards are available, distinguish Finished from Waiting for a learning card, display the next due time where applicable, and allow ending the session. No automatic review-ahead.

The exact compatible Anki methods and filtered-deck gathering implementation are builder decisions. A scheduler integration test must prove normal intervals, home-deck restoration, and budgets on the supported installed Anki release before shipping; a sorted list of due IDs with fabricated interval updates is not an acceptable substitute.

### Anki-compatible review shortcuts

Use the default Windows Anki bindings below for supported review actions. Use the active profile's answer-key and spacebar-rating preferences where available. Show shortcuts beside menu actions and on review buttons.

| Key | Action |
| --- | --- |
| Space / Enter | Reveal the answer; after reveal, select Good, subject to Anki's spacebar-rating preference. |
| 1 / 2 / 3 / 4 | Again / Hard / Good / Easy, after the answer is revealed. Support the numpad equivalents. |
| U / Ctrl+Z | Undo the latest eligible session action. Preserve normal text undo in editable fields. |
| E | Edit the current note; return to the same review state after saving. |
| R / F5 | Replay the current card's audio. |
| 5 / 6 / 7 | Pause/resume audio; seek backward/forward five seconds. |
| M | Open the current card's More menu. |
| I / Ctrl+Alt+I | Current / previous card information. |
| * | Toggle the note's marked tag. |
| - / = | Bury the current card / its note's cards. |
| @ / ! | Suspend the current card / its note's cards. |
| S | Return to the combined session overview without resetting progress. |
| / | Open the deck chooser. |
| O | Open the current home deck's options in Anki. |

Chrome reserves some shortcuts, notably Ctrl+1–7 for switching tabs, which overlaps Anki's flag shortcuts. Do not claim these can be overridden reliably: expose flag actions in More and provide optional alternate bindings. Browser-wide/developer commands, recording one's voice, destructive scheduling resets, and arbitrary add-on-defined bindings are not required to be recreated as review hotkeys in v1; retain an Open in Anki path for those workflows.

Only handle review shortcuts when the review surface is active. Ignore key-repeat, IME composition, text inputs, textareas, contenteditable regions, and open editing/confirmation dialogs. Numeric ratings before reveal are ignored. Prevent the browser default only for handled shortcuts. A focused native button's Enter/Space activation must not also dispatch a second review action. Modal and card-frame focus must not leak shortcuts into the wrong surface. Route shortcut actions through the same session revision, idempotency, native undo, and home-deck protections as mouse actions.

## Components and boundaries

- **Extension (TypeScript, Manifest V3):** capture activation and marker, modal, screenshot crop/OCR page, PDF.js reader, settings, and review tab. Bundle all code and OCR/PDF assets. Use locally scoped styles/Shadow DOM to avoid breaking reading pages.
- **Local backend (Python 3.12+, FastAPI proposed):** authenticated API, generation job queue, Codex process adapter, request deduplication, connection health, and calls to the Anki bridge. Generation/OCR must not block Anki's UI thread.
- **Bundled add-on (Python inside Anki):** active-profile access, deck metadata, notes and near-match data, card creation, native review sessions, safe undo, and media lookup. Marshal all collection and scheduler operations onto Anki's main thread; HTTP listener work stays off that thread.
- **Windows scripts:** setup, extension build, add-on packaging/install, start, and a small connection diagnostic. Re-running setup must preserve cards, settings, and credentials. Anki must be open with the intended profile; display actionable connection status otherwise.

Proposed source layout: `backend/`, `extension/`, `anki_addon/`, `scripts/`, `tests/`, `docs/`, and `dist/`. Generated runtime state/secrets are never included in a friend-shareable package. The current environment uses Windows ARM64 Python; avoid assuming an x64-only native dependency. Validate on this machine and document x64 installation compatibility honestly.

### Local authentication

Bind backend and add-on to loopback only, on configurable ports. Generate per-installation pairing secrets. The add-on's local settings and the backend's protected local settings share a bridge token; the extension receives only its backend pairing token through explicit local pairing. Allowlist the paired extension origin, validate Host/Origin, and require authentication on every data/mutation endpoint. No webpage can create cards by posting directly to localhost. Do not expose an arbitrary Python/SQL/shell execution endpoint.

Existing card HTML is isolated from extension/backend credentials. Serve media through a constrained authenticated mechanism; forbid arbitrary filesystem traversal and remote scripts. Keep ChatGPT OAuth credentials in the existing Codex credential store, never extension storage or project files.

## Codex generation

- Verify CLI installation, supported version, ChatGPT authentication, and available selected model. If API-key authentication is active, report a setup error; do not silently bill an API account.
- Proposed initial model: `gpt-6-luna`, configurable, with the lowest effort that passes representative vocabulary checks. Model access and actual latency must be verified on the user's account; no promised sub-second response.
- Invoke a narrowly configured noninteractive worker with a strict JSON output schema. It receives only the expression, language, and bounded relevant context. Isolate it from repository instructions, hooks, plugins, and MCP servers. Disable command/file tools for this inference worker using supported controls; validate those controls against the installed CLI version.
- Treat page/OCR text as quoted data, not instructions. The backend validates length, fields, language, and errors. Never grant the generation worker Anki credentials.
- Use a short bounded timeout, cancellation, and a small serialized queue. Quota/login/model errors leave drafts recoverable. No paid API fallback, automatic purchased-credit fallback, or account-credential sharing. Since subscription credit spending can also be controlled in ChatGPT account settings, setup must show users how to disable spending beyond their included plan allowance; the app must not claim it can override account billing policy.
- Cache successful definitions locally by normalized expression, language, relevant context, model, and prompt version. A changed sense/context must not reuse an unrelated definition.

## Validation and acceptance

Use meaningful unit tests for generation/custom-definition bypass, near matching, idempotency, and review state guards. Use Anki integration tests against a disposable profile/collection; never mutate the user's existing cards for tests.

Acceptance examples:

1. Selecting `chien`, choosing a deck, and pressing Send creates exactly one `the dog` / `le chien` card in that deck after generation.
2. A custom front produces zero Codex/dictionary requests and saves the editable back unchanged.
3. The sentence-fragment and idiom examples follow the content contract without unrelated text.
4. Existing `le chien` in the destination produces a near-match confirmation; the same card only in another deck does not. Editing the deck invalidates prior confirmation.
5. A scanned PDF crop yields editable text, including French accents; no screenshot enters the Anki note/media collection.
6. Text-PDF selection works in the bundled reader. Restricted-reader screenshot fallback works from the toolbar without injected controls.
7. Two chosen decks produce a mixed queue of eligible cards. Anki records each accepted rating once, updates native intervals, honors source budgets, and restores home decks after finishing/ending.
8. An interrupted save/rating can retry safely. Stale tabs/profile switches cannot update the wrong card.
9. A copied setup connects to that installation's profile and Codex login without carrying the original user's secrets or cards.
10. Browser QA covers a normal article, long/scrolled selections, a text PDF, scanned PDF capture, manual entry, duplicate alert, generation failure, and review reveal/rate/end behavior.
11. Add example unchecked creates one card; checked creates the vocabulary card and one separate example card in the selected deck. Retrying a two-card save creates neither duplicates nor a partial bundle. Custom-definition mode makes zero model calls even with an example requested.
12. Space and Enter reveal, then rate Good according to the profile preference; 1–4 rate only a revealed card. Editing a field, holding a key, or activating a focused button cannot accidentally rate the next card. Other supported shortcuts use the same native actions as the visible menus.

## Out of scope

Hosted services, ankiweb.net automation, mobile/macOS/Linux, a Chrome Web Store release, multi-user accounts, paid model APIs, automatic full-page reading, capture outside Chrome beyond pasted screenshots, image cards, pronunciation generation, automatic sync-service changes, and arbitrary interactive card-template JavaScript.

## Remaining implementation judgment

The builder chooses UI styling within the minimal mockup direction, exact endpoint names, dependency versions, conservative fuzzy-match thresholds, cache bounds, and packaging details. Verify installed Anki compatibility and the Codex worker before full feature construction; record any material incompatibility and adjust the design rather than replacing native scheduling with an approximation.

## Primary references

- Anki filtered decks and home-deck scheduling: https://docs.ankiweb.net/manual/filtered-decks
- Anki review behavior and shortcuts: https://docs.ankiweb.net/manual/studying
- Anki's default reviewer shortcut implementation: https://github.com/ankitects/anki/blob/main/qt/aqt/reviewer.py
- Anki add-on collection API: https://docs.ankiweb.net/addons/the-anki-module
- Chrome content scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome visible-tab capture and local file access: https://developer.chrome.com/docs/extensions/reference/api/tabs
- Codex noninteractive execution and schemas: https://learn.chatgpt.com/docs/non-interactive-mode
- ChatGPT versus API-key authentication: https://learn.chatgpt.com/docs/auth
- Codex model choices: https://learn.chatgpt.com/docs/models
- Alternative supported local ChatGPT sign-in: https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt

This folder was empty and was not a Git repository when inspected. The design is written here for review; it has not been committed. Repository initialization and product scaffolding wait for design approval.
