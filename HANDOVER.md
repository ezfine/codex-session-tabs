# HANDOVER.md

Last updated 2026-11-23 (Asia/Taipei)

## Current status

The Windows development checkout is at `C:\Projects\ThreadShelf` on
`windows-path-matching`. The branch starts from upstream commit
`9ddc83fbf3eb3c701fa3981741cdef2969e58e22` and adds this project's setup
documentation. The Windows path fix is pending.

## Setup decisions

- `origin` is the public GitHub fork, [ezfine/codex-session-tabs](https://github.com/ezfine/codex-session-tabs).
  `upstream` is [mrkarmannik/codex-session-tabs](https://github.com/mrkarmannik/codex-session-tabs).
  Local `main` tracks `origin/main`.
- The four project documents follow aiProjectTemplate 2.0.0. The checkout
  contains all four files and has no dependency on the master template.
- Open the checkout through `C:\Projects\ThreadShelf` to keep the short path.
  Its parent junction resolves to `C:\OneDrive\Projects`.

## Verification

- GitHub reports the expected upstream as the fork's parent.
- The upstream standalone suite passed with Node.js 24.12.0.
- From the short checkout path, `fs.realpathSync.native(process.cwd())`
  resolves to the physical checkout. Passing the resolved path as `cwd` and
  the short path as the workspace folder to `inProject` returns `false`.
  This reproduction reads filesystem paths without accessing chat data.
- VS Code integration and authenticated tests are pending.

## Next steps

1. Inspect the project keys in `project-paths.js`, the history filter in
   `app-server.js`, and the history groups in `session-projects.js`.
2. Add Windows regression coverage with temporary directory symlinks and
   junctions. A link and its target should match for the project filter and
   group together in history. Distinct sibling folders and subfolders should
   remain distinct. Cover unavailable targets and preserve existing Windows,
   UNC, extended path, and POSIX matching behavior.
3. Run `npm test` and record the results here. Verify the **This project**
   filter and project grouping in an isolated VS Code profile when doing
   integration verification. Keep any example chat data synthetic.
