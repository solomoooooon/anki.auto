# SDD ledger — plan: docs/superpowers/plans/2026-11-09-anki-auto.md

Approved by the user on 2026-11-09, including example cards and Anki shortcuts.

Ruling: Execute inline in the user's explicitly named fresh folder, on a feature branch, rather than creating a second worktree — preserves the requested location and avoids unnecessary approvals — no existing product files or branch to protect.

Ruling: Use Python's standard HTTP/SQLite libraries instead of proposed FastAPI — avoids native-package installation friction on Windows ARM64 — more explicit request validation to maintain.

Pre-flight: Task 1 contracts/matching are shared by Task 2 and 3; use snake_case serialized dataclasses. Task 2 dispatch supplies Task 3 routes; Task 4/5 consume those routes. Shared integration types will be kept in contracts and the extension API module.
Task 1: contracts and matching 8/8 tests passed after RED (missing modules). Live Codex subscription probe returned valid French vocabulary/example JSON in 6.19s. Ruling: use gpt-5.6-luna, the lightweight model advertised by this installation and verified by a real call; gpt-6-luna from public docs was rejected by this account. Model remains configurable. Commits are authored as Codex locally because no user Git identity is configured; global Git settings are unchanged.
