'use strict';

// Run only in a separate --user-data-dir with generateTitles disabled.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const vscode = require('vscode');
const { inProject } = require('../project-paths');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.run = async () => {
  const checks = [], created = [];
  let api;
  const nativeTabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
    tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'chatgpt.conversationEditor');
  const waitFor = async predicate => {
    for (let n = 0; n < 100; ++n) { const value = predicate(); if (value) return value; await sleep(100); }
    throw new Error('Timed out waiting for the test editor');
  };
  try {
    const settings = vscode.workspace.getConfiguration('codexSessionTabs');
    assert.equal(settings.get('generateTitles'), false, 'Use an isolated test profile');
    assert.equal(settings.get('chatMode'), 'native');
    api = await vscode.extensions.getExtension(require('./extension-id')).activate();
    const client = await api.createClient();
    const fixtureFile = process.env.CODEX_TABS_TEST_FIXTURES;
    const binary = client.binary;
    try {
      const all = await client.list();
      const folders = vscode.workspace.workspaceFolders.map(folder => folder.uri.fsPath);
      const variants = folders.map(folder => folder.replace(/\\/g, '/').toUpperCase() + '/');
      const filtered = await client.list({ cwd: variants });
      assert.ok(filtered.data.every(thread => inProject(thread.cwd, folders)));
      for (const thread of all.data.filter(thread => inProject(thread.cwd, folders))) {
        assert.ok(filtered.data.some(value => value.id === thread.id), 'Alternate spellings keep matching sessions');
      }
      checks.push('Real Windows app-server history accepts alternate path spellings');
    } finally { await client.shutdown(); }

    for (let n = 0; n < 2; ++n) {
      const thread = await vscode.commands.executeCommand('codexSessionTabs.newChat');
      assert.ok(thread?.id, 'New chat returns a real session');
      created.push(thread.id);
      if (fixtureFile) await fs.writeFile(fixtureFile, JSON.stringify({ binary, ids: created }));
      await waitFor(() => nativeTabs().find(tab => tab.input.uri.path === `/local/${thread.id}`));
    }
    assert.notEqual(created[0], created[1]);
    assert.equal(nativeTabs().length, 2, 'New chats keep separate editor resources');
    assert.ok(nativeTabs().every(tab => !tab.isPreview));
    checks.push('Two new graphical chats have distinct IDs and pinned editor tabs');
    await api.openSession(created[0]);
    assert.equal(nativeTabs().length, 2);
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab.input.uri.path, `/local/${created[0]}`);
    const first = nativeTabs().find(tab => tab.input.uri.path === `/local/${created[0]}`);
    await vscode.window.tabGroups.close(first);
    await vscode.commands.executeCommand('codexSessionTabs.reopenClosed');
    await waitFor(() => nativeTabs().find(tab => tab.input.uri.path === `/local/${created[0]}`));
    checks.push('Refocus and reopen preserve the original session ID');

    await api.tabs.setProjectFilter(true);
    await api.sidebar.refresh();
    assert.ok(!api.sidebar.historyError, api.sidebar.historyError);
    assert.ok(api.sidebar.threads.every(thread => inProject(thread.cwd, vscode.workspace.workspaceFolders.map(folder => folder.uri.fsPath))));
    checks.push('Project history refresh works in VS Code ' + vscode.version + ' on ' + process.platform);
    if (process.env.CODEX_TABS_UI_READY_FILE) {
      let rendered;
      for (let n = 0; n < 700; ++n) {
        try { rendered = JSON.parse(await fs.readFile(process.env.CODEX_TABS_UI_READY_FILE, 'utf8')); } catch {}
        if (rendered) break;
        await sleep(100);
      }
      assert.equal(rendered?.ready, true, 'Official Codex renderer must display a composer');
      checks.push('Official Codex renderer displays a composer without sending a message');
    }
    if (process.env.CODEX_TABS_LIVE_DIR) {
      const path = require('node:path'), { randomBytes } = require('node:crypto');
      const root = process.env.CODEX_TABS_LIVE_DIR;
      const token = 'RELEASE_OK_' + randomBytes(5).toString('hex');
      const title = 'Release verification ' + token.slice(-10);
      const id = created[0];
      await api.titles.rename(id, title);
      await vscode.window.tabGroups.close(nativeTabs().find(tab => tab.input.uri.path === `/local/${id}`));
      await sleep(700);
      await api.openSession(id);
      const inspect = await api.createClient();
      try {
        const awaitReply = async minimum => {
          for (let n = 0; n < 150; ++n) {
            const { thread } = await inspect.request('thread/read', { threadId: id, includeTurns: true });
            const turns = thread.turns || [];
            const replies = turns.filter(turn => turn.status === 'completed').flatMap(turn => turn.items || [])
              .filter(item => item.type === 'agentMessage' && item.text?.includes(token));
            if (replies.length >= minimum) return;
            await sleep(500);
          }
          throw Error('The live test did not receive its expected reply');
        };
        await inspect.start();
        await fs.writeFile(path.join(root, 'request.json'), JSON.stringify({ phase: 'first', title,
          prompt: `Reply with exactly ${token}. Do not use tools, read files or change anything.` }));
        await awaitReply(1);
        checks.push('First message sent through the official composer and completed');
        await vscode.window.tabGroups.close(nativeTabs().find(tab => tab.input.uri.path === `/local/${id}`));
        await sleep(700);
        await api.openSession(id);
        await fs.writeFile(path.join(root, 'request.json'), JSON.stringify({ phase: 'resume', title,
          prompt: 'Repeat the exact confirmation token from your previous reply. Do not use tools, read files or change anything.' }));
        await awaitReply(2);
        checks.push('Graphical conversation reopened and continued with its prior context');
      } finally { await inspect.shutdown(); }
    }
    await fs.writeFile(process.env.CODEX_TABS_TEST_RESULT, JSON.stringify({ ok: true, checks,
      captions: nativeTabs().map(tab => tab.label) }, null, 2));
  } catch (error) {
    await fs.writeFile(process.env.CODEX_TABS_TEST_RESULT, JSON.stringify({ ok: false, checks, error: error.stack }, null, 2));
    throw error;
  } finally {
    if (api) {
      for (const tab of nativeTabs()) if (created.some(id => tab.input.uri.path === `/local/${id}`)) await vscode.window.tabGroups.close(tab);
      // The runner archives fixtures after this host and its writer have exited.
    }
  }
};
