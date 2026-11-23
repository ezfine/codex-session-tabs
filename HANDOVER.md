# HANDOVER.md

Last updated 2026-11-23 (Asia/Taipei)

## Current status

The Windows development checkout is at `C:\Projects\ThreadShelf` on
`windows-path-matching`, based on upstream commit `9ddc83f`. The Windows
path fix is local. **This project** and history grouping use the same resolved
folder identity for drive-letter paths through symbolic links and junctions.
The original thread paths are retained for display and session actions.

## Setup decisions

- `origin` is the public GitHub fork, [ezfine/codex-session-tabs](https://github.com/ezfine/codex-session-tabs).
  `upstream` is [mrkarmannik/codex-session-tabs](https://github.com/mrkarmannik/codex-session-tabs).
  Local `main` tracks `origin/main`.
- The four project documents follow aiProjectTemplate 2.0.0. The checkout
  contains all four files and has no dependency on the master template.
- Open the checkout through `C:\Projects\ThreadShelf` to keep the short path.
  Its parent junction resolves to `C:\OneDrive\Projects`.
- Unavailable folders fall back to normalized path text. Direct UNC paths use
  normalized text without probing the share. Resolution results are reused
  within a history query or render and refreshed on the next operation.

## Verification

- GitHub reports the expected upstream as the fork's parent.
- `npm test` passed on Windows with Node.js 24.12.0. The new regression
  reproduced the junction mismatch before the fix and now verifies matching in
  both directions, history grouping, distinct siblings and subfolders, and
  fallback for a dangling junction.
- Windows denied creation of a temporary directory symbolic link, so that
  fixture was skipped. A separate read-only check using the existing
  `C:\Users\All Users` symbolic link to `C:\ProgramData` passed for history
  filtering in both directions and grouping.
- The short checkout path and its physical path matched and formed one group
  in a local check with synthetic threads.
- VS Code integration and authenticated tests were not run.

## Next steps

1. When doing integration verification, check the **This project** filter
   and project grouping in an isolated VS Code profile with synthetic chats.
