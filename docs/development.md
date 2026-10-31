# Development

The extension is plain CommonJS JavaScript with no runtime dependencies. Node.js 22 or newer is needed for development tools.

```powershell
git clone git@github.com:mrkarmannik/codex-session-tabs.git
cd codex-session-tabs
npm ci --ignore-scripts
npm test
```

Open the folder in VS Code and press F5 to start an Extension Development Host. Install and sign in to the official OpenAI Codex extension in that environment. Disable any older `local-tools.codex-session-tabs` build to avoid duplicate commands.

## Checks

- `npm test` runs standalone tests with fake clients. It does not use account data or call a model.
- `npm run review:sidebar -- review` captures the sidebar in a separate VS Code profile using invented chat and quota fixtures. It disables other installed extensions and checks the project switch, search reset and retry actions. Artifacts are saved under ignored `previews/`.
- `npm run test:windows` uses a separate VS Code profile, reads history metadata and creates two empty test conversations. It closes only its own tabs and archives only those fixture conversations after VS Code exits.
- `npm run test:windows -- --ui` also verifies that the official graphical composer appears.
- `npm run test:windows -- --package --ui` installs the built VSIX into an isolated extensions directory and tests that installed package. The existing official Codex extension is exposed through a temporary directory junction, without copying its binaries or changing the working installation.
- `npm run test:windows -- --live` sends two short messages to a test conversation through the official composer, closes and reopens it, and checks that the continuation preserves context. **This uses the signed-in Codex account and consumes model allowance.** Run it deliberately, not as part of routine CI.

Integration tests use the existing Codex account configuration. Never point them at an active user conversation. Do not include credentials, profiles or private chat text in reports.

## Packaging

```powershell
npm run build:icon
npm run package
npm run verify:package
```

The package is a Windows x64 preview. Its file allowlist excludes tests, build dependencies, internal documents and tools. The verifier checks the ZIP contents, publisher, platform and icon dimensions. The SVG icon source is original; PNG output is generated deterministically with resvg.

CI runs standalone checks on Windows and Linux and builds the Windows VSIX. It does not run authenticated integration tests and does not publish to Marketplace.

## Compatibility

The initial preview is checked on VS Code 1.111.0 x64 and OpenAI Codex 26.1021.22027 on Windows. Its graphical chat integration uses the official extension's internal `chatgpt.conversationEditor` and `openai-codex://route/local/<id>` route. These are not a supported public API contract; check them when updating Codex.

Do not close a user's chat to update its title. A draft or response may still be active. Do not modify the official extension or rebuild its frontend as part of this extension's activation or installation.

## Dependencies

The shipped extension has no npm runtime dependencies. Development uses pinned versions of `@vscode/vsce` and `@resvg/resvg-js`, recorded in `package-lock.json`. Build-tool dependencies may have advisories independent of the runtime package; `npm audit --omit=dev` checks the runtime dependency set.
