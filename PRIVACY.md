# Data and privacy

ThreadShelf for Codex runs in the VS Code extension host. It has no telemetry, advertising, analytics SDK, or separate backend.

## Data used

- The local Codex app-server supplies chat metadata: IDs, titles, previews, project paths and update times. It also supplies account usage limits.
- VS Code extension storage holds pinned-chat metadata, closed-tab history, terminal records, manually named chat IDs and view preferences.
- VS Code settings hold the selected language, chat mode, title model, title-generation preference and optional CLI path.
- Diagnostic errors may appear in the **ThreadShelf** output channel. Review logs before sharing them: Codex process errors may contain local paths or other details.

The extension does not read `auth.json` directly. Authentication is handled by the installed Codex executable and official extension.

## Model requests

Automatic terminal-chat titles and the explicit **Generate chat title** action send up to 4,000 characters of the first message to a model through the user's authenticated Codex app-server. The request uses an ephemeral thread with tools and configured MCP servers disabled. It consumes account allowance. Automatic requests can be disabled with **Generate Titles**.

Reading the chat list and usage limits does not send a user message to a model. Opening and sending messages in a graphical chat or CLI is handled by Codex and is subject to that product's account and privacy settings.

## Sharing and storage

There is no extension-operated service receiving chat data. Network requests made by Codex go through the existing Codex configuration and service providers.

This extension does not archive or delete conversations when a tab is closed. Codex owns conversation storage. Uninstalling this extension does not delete Codex chats. Clearing VS Code extension storage can remove pins and view preferences.

Do not attach credentials, private chat content or unreviewed logs to public issues.
