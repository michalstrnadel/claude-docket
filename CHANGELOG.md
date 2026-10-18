# Changelog

## Unreleased

- Band: a task id no longer wraps under a long title (`#10` rendered as `#1` with `0` on the next line).
- Band: the id column now has a fixed width, so a two-digit id stays whole even when the row overflows (`#27` still split into `#2` / `7`).

## 0.1.0 — 2026-10-15

First release.

- Task band above the prompt: progress bar, the item in progress, blocked and next items; folds to one line with `/dk`.
- Board pane (`/docket`): lists you can fold, `all`/`open` filter, Enter cycles ○ → ◐ → ●, add a task inline, clear done.
- `docket` tool for Claude: `view`, `plan`, `add`, `update`, `remove`, `clear_done`. `plan` refuses to overwrite open work unless asked.
- Board lives in `.claude/docket.json` in the project: survives crashes, restarts and new sessions; hand edits are picked up live and a broken file never wipes the last good board.
- Plays well with other mods: the band draws on top of other bands instead of replacing them, and shrinks to one line while the board is open.
- Mirrors Claude Code's own todo list into a `Session` list where that tool runs.
