# ThreadShelf for Codex

Use English for code and comments. Check git status before editing. Read docs/development.md.

Run npm test for standalone checks. Authenticated integration tests must use separate profiles and their own conversations. Live tests consume account allowance. Never publish credentials, user profiles or private conversations. Do not modify the official Codex extension or close user chats to update titles.

## Reading order

1. Read this file, then [README.md](README.md) for scope and setup.
2. Read [HANDOVER.md](HANDOVER.md) for status, verification and next steps.
3. Read [docs/development.md](docs/development.md) and inspect relevant code
   and tests before changing behavior.

## Fork workflow

- Use the short Windows checkout path under `C:\Projects`. Check Git status
  and remotes before editing. Use `origin` for the fork and fetch original
  project changes from `upstream`.
- Keep changes scoped, preserve existing callers and unrelated work, and
  follow upstream conventions. Use synthetic thread and path fixtures.
- Keep stable setup in README.md. Update HANDOVER.md when scope, decisions,
  verification, blockers or next steps change. Record what was verified and
  what remains pending.
