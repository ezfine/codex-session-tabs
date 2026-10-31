# Changelog

## 0.9.1 — Marketplace display name

- Rename the extension to **ThreadShelf for Codex** because the previous display name is already taken.
- Keep the extension ID, settings and storage keys unchanged.
- Derive the VSIX filename from the package version to avoid uploading an older build by mistake.

## 0.9.0 — First public preview

- Publish as `MrKarmannik.codex-session-tabs` for Windows x64 and VS Code 1.111.0 or newer.
- Open Codex conversations in pinned editor tabs, with terminal mode as an alternative.
- Group history by project, rank projects by recent loaded activity, and switch the project filter from the list.
- Add search, pinned chats, closed-tab restoration, renaming and optional model-generated terminal titles.
- Show actual account quota windows, remaining allowance and reset times.
- Support English and Russian interfaces and normalized Windows, UNC and extended paths.
- Replace the copied Codex icon with an original session-tabs mark.
- Include public setup, privacy and compatibility notes. Exclude local patch tools, diagnostics and development files from the VSIX.

Earlier 0.8.x builds used the private `local-tools` publisher ID and were distributed as local VSIX files.
