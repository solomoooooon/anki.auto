# anki.auto

A personal, Windows-only Chrome extension and Python backend for capturing English/French vocabulary into **your local Anki**, plus a browser reviewer that mixes selected decks through Anki’s native scheduler.

## First run

Requires **Anki 25.09.5 or compatible newer desktop Anki**, **Python 3.11+**, **Node.js 24 LTS**, and current Chrome. This version was integrated against Anki 25.09.5; Anki internals may change in future releases.

1. Run `setup.cmd` (or `npm ci`, `npm run check`, then `python scripts/package.py`). This builds the extension and `dist/anki.auto.ankiaddon`. A shared `anki.auto-windows.zip` already includes the built extension/add-on, so rebuilding is optional.
2. In Anki: **Tools → Add-ons → Install from file**, choose `dist/anki.auto.ankiaddon`, then restart Anki. Open the profile you want to use. **Tools → anki.auto connection** shows the local bridge connection.
3. In Chrome: open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, select `dist/extension`. Pin anki.auto to the toolbar. For local PDFs, enable **Allow access to file URLs** in the extension’s details.
4. For automatic definitions, install and sign into Codex CLI once:

   ```powershell
   npm install -g @openai/codex
   codex login
   ```

   Choose **ChatGPT sign-in**. An open ChatGPT tab is unnecessary. Custom definitions work without Codex.
5. Run `start.cmd`. Keep the console and Anki open. In extension **Settings**, enter the console’s one-time pairing code. Codes expire in 10 minutes; restarting the backend supplies a new one.
6. Use the toolbar toggle to enable highlighting. Select words, click **✓**, choose the destination deck, and **Send**. The compact modal closes as soon as the local queue accepts the capture. Translation and saving continue in the background. Open the extension’s **Recent captures** to check progress or open the saved card.

## Capture

- `chien` → **the dog** / **le chien**. French noun articles are included. English vocabulary produces an English definition / original word.
- Sentence fragments retain their context and ellipses. Idioms include the actual English meaning and a brief literal translation. The surrounding paragraph helps disambiguate the selected expression; expand **Context** when needed.
- **Custom definition** becomes the front; the editable selection becomes the back. It skips generation entirely. Choose the source language if automatic detection is unavailable. Add an article yourself when editing a custom French noun.
- **Add example** adds a second card from the same note: English sentence / French sentence using the selected expression. This applies to French vocabulary only. With a custom definition, enter both example sentences yourself; no model is called.
- Similar expressions are checked only in the exact destination deck, including cards temporarily being reviewed in a filtered deck. An alert shows near matches and asks **Continue anyway**. Changing the term/deck or a matching note requires another confirmation. It never silently merges cards.
- Custom definition and sentence context are expandable controls so the normal capture form stays compact. The article/PDF overlay fits the form’s current size instead of occupying most of the screen.
- Captures retain their draft, job ID, and result across tab closure. **Recent captures** shows queued, preparing, saved or needs-attention status; click an entry to view/edit its card or resolve an error. The toolbar badge shows the pending count, or **!** for a failure/confirmation that needs attention. **Reopen last capture** also resumes the latest one. Retrying an uncertain save uses the same request ID to prevent duplicate notes. Editing the draft creates a new capture ID.
- Anki must be open. If Anki is busy with a blocking dialog, close it and retry. The active Anki profile determines which collection is used.
- Each capture is bound to the collection from which its destination was selected. Switching profiles while generation runs stops the save; reopen the original profile and retry.

## PDFs and screenshots

Use **Open PDF reader** in the toolbar for selectable PDFs. You can open a downloaded file if its site requires cookies or its own viewer. Select text on a page, then click **✓**.

For scanned PDFs, use **Extract this page**. For images, browser PDF viewers, or canvas text, use **Screenshot → extract text** from the toolbar. Crop the words, extract locally, correct the recognized text, then select the portion to capture. You can also paste a screenshot with Ctrl+V or open an image file. Chrome restricts screenshots on some internal pages; use a pasted screenshot there.

PDF.js and English/French Tesseract OCR assets are bundled locally. Screenshots are temporary extension-session data and are removed when opened for cropping; no image is added to Anki or passed to the translation worker. Ordinary page capture needs Chrome site access; browser-owned pages and some protected/embedded viewers use the screenshot/paste fallback. The extension does not replace Chrome’s default PDF viewer.

## Review

Open **Review combined queue**, select decks, and start. Selected parents include descendants; selecting both does not duplicate cards. Daily limits, ancestor budgets, learning steps, sibling burying, scheduler intervals and rating history come from Anki. The queue uses a managed, rescheduling filtered deck named `anki.auto Review (managed)`; cards retain their original home deck. **Decks** ends the session and returns remaining cards home. Do not repurpose that managed deck.

Keep the desktop reviewer idle while using the browser reviewer. External Anki changes pause browser actions until you explicitly **Refresh / resume**. A session interrupted by a restart can be resumed or ended. After Anki’s day rollover, end it and start a new queue. Ratings are guarded against double submission, stale tabs, and replayed HTTP requests. Lost responses expose **Retry last action** with the same action ID.

| Shortcut | Action |
|---|---|
| Space / Enter | Reveal, then Good (honors Anki’s Space preference) |
| 1 / 2 / 3 / 4 | Again / Hard / Good / Easy after revealing; custom Anki answer keys honored |
| U / Ctrl+Z | Undo the latest browser review action |
| E | Edit note fields |
| R / F5 | Replay available audio |
| 5 / 6 / 7 | Pause/resume audio / seek backward / forward 5 seconds |
| * | Mark note |
| − / = | Bury card / note |
| @ / ! | Suspend card / note |
| I / Ctrl+Alt+I | Current / previous card information |
| M | More actions, including flags (Chrome reserves Ctrl+1–7) |
| O | Open the home deck’s native Anki options |
| S / / | End session and choose decks |

Shortcuts ignore typing, dialogs, held keys, and composition. Focused buttons retain normal Enter/Space activation. New vocabulary cards contain text only. Existing cards support basic HTML/CSS, local images and audio; script-based templates, video, native TTS, and MathJax are not implemented. Use Anki’s native editor for rich formatting. The plain-text editor replaces only fields you actually change.

## ChatGPT usage and local data

The worker invokes the installed **Codex CLI using ChatGPT subscription authentication**. It does not use a separate API key, automate a ChatGPT tab, or require ChatGPT to be open. Subscription usage limits still apply; any account setting allowing extra purchased usage is controlled by your account. Disable paid/extra credits in your account if you want a hard no-additional-spend limit. The app cannot inspect or cap the account’s billing settings.

The default model is `gpt-5.6-luna`, verified on this computer’s account. Model availability varies by account. Change `model` in `%LOCALAPPDATA%\anki.auto\settings.json` and restart the backend if needed. Failures retain the draft; a custom definition remains available. No fallback to paid API authentication occurs.

Only the selected text, source-language hint and surrounding context are sent to Codex for generation. Source URL/title are stored locally with the note. Custom definitions bypass Codex. The worker uses an isolated temporary directory, ignores user project instructions/config, disables shell/plugins/web tools, and validates plain structured output.

Backend/bridge listen only on loopback (ports 8766/8767), authenticate requests and pair the extension’s origin. Runtime credentials, capture jobs/cache and review recovery journals live in `%LOCALAPPDATA%\anki.auto`, outside this project. Anki holds the actual notes, cards and scheduling history. The extension stores its pairing token and recent drafts in Chrome’s local extension storage. Keep runtime settings private. To use another runtime directory, set `ANKI_AUTO_HOME` consistently before launching **both Anki and the backend**.

## Share with a friend

Send **`dist/anki.auto-windows.zip`**. Extract it, install the prerequisites, install its add-on, load its built extension, and run `start.cmd`. Your friend pairs locally and signs into their own ChatGPT account. Their open Anki profile supplies their decks/cards. The archive contains no runtime secrets, cards or account credentials. Do not share `%LOCALAPPDATA%\anki.auto` or your Chrome profile.

## Development and checks

```powershell
npm ci
npm run check
python -m unittest discover -s tests -v
python scripts/package.py
```

Native integration tests need Anki’s Python (ordinary Python skips them):

```powershell
& "$env:LOCALAPPDATA\AnkiProgramFiles\.venv\Scripts\python.exe" -m unittest discover -s tests -v
```

Tests create disposable collections; they do not open your collection. Mockups: `docs/mockups/anki-auto-preview-v2-standalone.html`. Spec/implementation plan: `docs/superpowers/`. Bundled asset licenses are in `dist/extension/licenses` and `THIRD-PARTY.txt`.

Validation evidence and the remaining Chrome interaction checklist: [`docs/verification.md`](docs/verification.md). Automated checks do not establish browser interaction or visual quality.

To uninstall, end any active browser session first, remove the extension/add-on, and stop the backend. Vocabulary notes remain normal Anki notes. If a crash left cards in the managed filtered deck, empty that deck from Anki to return them home before deleting it.
