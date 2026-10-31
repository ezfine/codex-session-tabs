# 0.9.0 preview checks

Checked on 31 October 2026 with Windows x64, VS Code 1.111.0 and OpenAI Codex 26.1021.22027.

| Check | Result |
| --- | --- |
| Standalone quota, title, history, path and localization tests | Passed |
| Separate VS Code profile: create two distinct pinned chat tabs | Passed |
| Refocus, close and reopen the same conversation ID | Passed |
| Windows project filtering with alternate path spellings | Passed |
| Official graphical composer renders | Passed |
| First controlled message through the official composer | Passed |
| Close, reopen, and continue with the previous reply in context | Passed |
| Tool use in the two controlled turns | None observed |
| Install and open the built VSIX from an isolated extensions directory | Passed |
| Sidebar fixtures at 240 and 340 px in dark and light themes | Passed |
| Project switch by mouse and Enter; empty-search reset and retry | Passed |
| Package file allowlist, publisher, target and 256px icon | Passed |
| npm runtime dependency audit | No runtime dependencies or reported runtime vulnerabilities |

Live checks used two short messages in a fixture conversation. Only test-created chats were closed and archived. Gallery screenshots use invented chats and quota values.

The Linux CI job covers standalone JavaScript tests only; it does not establish Linux GUI support. Remote SSH, WSL, macOS, ARM64 and interruption during an active model response are outside this preview's tested scope.

The official conversation editor uses internal routes. Its current title behavior is described in the README. No local patch tools or copied OpenAI branding are included in the public package.
