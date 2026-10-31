'use strict';
// Visual fixtures only: no account, history, CLI, or model requests.
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { inProject } = require('../project-paths');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.run = async () => {
  const root = process.env.CODEX_TABS_REVIEW_DIR;
  const api = await vscode.extensions.getExtension(require('./extension-id')).activate();
  clearInterval(api.sidebar.timer);
  const now = Math.floor(Date.now() / 1000);
  const english = process.env.CODEX_TABS_REVIEW_LANGUAGE === 'en';
  const say = (en, ru) => english ? en : ru;
  const thread = (id, name, age, cwd = 'C:\\Work\\billing') => ({ id, name, cwd, updatedAt: now - age });
  const active = thread('demo-open', say('Check payment handling', 'Проверить обработку платежей'), 60);
  const pinned = thread('demo-pinned', say('Plan the next release', 'План следующего релиза'), 600);
  const threads = [active, pinned,
    thread('demo-long', say('Fix duplicate notifications after reconnect', 'Исправить повторную отправку уведомлений при восстановлении соединения'), 120),
    ...Array.from({ length: 9 }, (_, n) => thread('demo-' + n, (english ? ['Review tests', 'Investigate the import error', 'Update documentation'] : ['Проверить тесты', 'Разобрать ошибку импорта', 'Обновить документацию'])[n % 3], 1000 + n * 86400)),
    thread('demo-second', say('Add report export', 'Добавить экспорт отчёта'), 3600, 'D:\\Archive\\billing'),
    thread('demo-third', say('Check application startup', 'Проверить загрузку приложения'), 7200, 'C:\\Work\\desktop'),
    thread('demo-none', say('A setup question', 'Вопрос по настройке'), 86400, null),
  ];
  const usage = { rateLimits: { limitId: 'codex', planType: 'pro',
    primary: { usedPercent: 18, windowDurationMins: 300, resetsAt: now + 3600 },
    secondary: { usedPercent: 77, windowDurationMins: 10080, resetsAt: now + 86400 * 3 },
  } };
  let currentThreads = threads;
  api.sidebar.actions.scheduleTitles = () => {};
  api.sidebar.createClient = async () => ({ list: async ({ cwd } = {}) => ({
    data: cwd?.length ? currentThreads.filter(thread => inProject(thread.cwd, cwd)) : currentThreads, nextCursor: null }),
    rateLimits: async () => currentUsage, dispose() {} });
  let currentUsage = usage;
  api.tabs.pins = [pinned];
  const opened = () => [{ id: active.id, label: active.name, thread: active, uri: vscode.Uri.parse('openai-codex://route/local/demo-open') }];
  api.tabs.openTabs = opened;
  await vscode.workspace.getConfiguration('codexSessionTabs').update('language', english ? 'en' : 'ru', vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  await vscode.commands.executeCommand('workbench.view.extension.codexSessionTabs');
  await api.sidebar.refresh();
  let previous;
  for (let n = 0; n < 1800; ++n) {
    let request;
    try { request = JSON.parse(await fs.readFile(path.join(root, 'request.json'), 'utf8')); } catch {}
    if (request?.done) return;
    if (request && request.id !== previous) {
      previous = request.id;
      await vscode.workspace.getConfiguration('workbench').update('colorTheme', request.theme, vscode.ConfigurationTarget.Global);
      currentUsage = request.scenario === 'quota-empty' ? {} : usage;
      const empty = ['empty', 'project-empty'].includes(request.scenario);
      currentThreads = request.scenario === 'empty' ? [] : threads;
      api.tabs.pins = empty ? [] : [pinned];
      api.tabs.openTabs = empty ? () => [] : opened;
      await api.tabs.setProjectFilter(request.scenario === 'project-empty');
      await api.sidebar.refresh();
      await api.sidebar.setSearch(request.scenario === 'search-empty' ? 'несуществующий чат' : request.scenario === 'search-hit' ? 'импорт' : '');
      if (request.scenario === 'error') {
        api.sidebar.historyError = api.sidebar.usageError = 'Не удалось подключиться к Codex. Повторите обновление.';
        api.sidebar.renderUsage();
      }
      api.sidebar.changed.fire();
      await sleep(500);
      await fs.writeFile(path.join(root, 'ready.json'), JSON.stringify({ id: request.id }));
    }
    await sleep(100);
  }
  throw Error('Visual review timed out');
};
