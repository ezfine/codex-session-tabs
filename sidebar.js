'use strict';

const { t, locale } = require('./i18n');

const vscode = require('vscode');
const { quotaBuckets } = require('./usage');
const { usageHtml } = require('./usage-view');
const { projectFilter } = require('./project-paths');
const { groupProjects, projectName } = require('./session-projects');

const title = thread => (thread.name?.trim() || thread.preview?.trim() || t("Untitled")).replace(/\s+/g, ' ');
const date = seconds => new Date(seconds * 1000).toLocaleString(locale(), {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});
const shortDate = seconds => {
  if (!Number.isFinite(seconds)) return '';
  const value = new Date(seconds * 1000), now = new Date();
  if (value.toDateString() === now.toDateString()) return value.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  return value.toLocaleDateString(locale(), { day: 'numeric', month: 'short', ...(value.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
};
const info = (label, description, icon = 'info') => ({ kind: 'info', label, description, icon });
const group = (label, children, icon) => ({ kind: 'group', label, children, icon });

class Sidebar {
  constructor(context, tabs, createClient, actions, report) {
    this.context = context;
    this.tabs = tabs;
    this.scope = tabs.filterProject;
    this.createClient = createClient;
    this.actions = actions;
    this.report = report;
    this.threads = [];
    this.cursor = null;
    this.loadedPages = 1;
    this.scopeRevision = 0;
    this.query = '';
    this.changed = new vscode.EventEmitter();
    this.disposed = false;
    this.views = ['codexSessionTabs.sessions'].map(id => {
      const provider = {
        onDidChangeTreeData: this.changed.event,
        getChildren: element => element?.children || (id.endsWith('usage') ? this.usageRoots() : this.sessionRoots()),
        getTreeItem: element => this.treeItem(element),
      };
      return vscode.window.createTreeView(id, { treeDataProvider: provider, showCollapseAll: true });
    });
    const usageRegistration = vscode.window.registerWebviewViewProvider('codexSessionTabs.usage', {
      resolveWebviewView: view => {
        this.usageView = view;
        view.title = t('Usage');
        view.webview.options = { enableScripts: false, localResourceRoots: [] };
        this.renderUsage();
        this.disposables.push(view.onDidChangeVisibility(() => {
          if (view.visible) void this.refresh();
        }));
        void this.refresh();
      },
    });
    this.disposables = [this.changed, ...this.views, usageRegistration,
      tabs.onDidChange(() => {
        if (this.scope !== tabs.filterProject) {
          this.scope = tabs.filterProject;
          ++this.scopeRevision;
          this.loadMoreAgain = false;
          this.threads = [];
          this.cursor = null;
          this.loadedPages = 1;
          this.updatedAt = undefined;
          this.historyError = undefined;
          void this.refresh();
        }
        this.changed.fire();
      }),
      actions.onTitleChange(({ id, name }) => {
        for (const thread of this.threads) if (thread.id === id) thread.name = name;
        this.changed.fire();
      }),
      ...this.views.map(view => view.onDidChangeVisibility(event => {
        if (event.visible && (!this.updatedAt || Date.now() - this.updatedAt > 60000)) void this.refresh();
      })),
      vscode.commands.registerCommand('codexSessionTabs.refresh', () => this.refresh()),
      vscode.commands.registerCommand('codexSessionTabs.loadMore', () => this.refresh(true)),
      vscode.commands.registerCommand('codexSessionTabs.search', () => this.search()),
      vscode.commands.registerCommand('codexSessionTabs.clearSearch', () => this.setSearch('')),
      vscode.commands.registerCommand('codexSessionTabs.toggleProject', async () => {
        await tabs.setProjectFilter(!tabs.filterProject);
        await this.refresh();
      }),
      vscode.commands.registerCommand('codexSessionTabs.sidebar.open', node => this.open(node).catch(report)),
      vscode.commands.registerCommand('codexSessionTabs.sidebar.beside', node => this.open(node, true).catch(report)),
      vscode.commands.registerCommand('codexSessionTabs.sidebar.pin', node => tabs.togglePin(node.thread).catch(report)),
      vscode.commands.registerCommand('codexSessionTabs.sidebar.close', node => tabs.close(node.uri).catch(report)),
    ];
    this.updateLanguage();
    this.timer = setInterval(() => {
      if (this.usageView?.visible || this.views.some(view => view.visible)) void this.refresh();
    }, 60000);
  }

  async refresh(more = false) {
    if (this.disposed) return;
    if (this.loading) {
      if (more) this.loadMoreAgain = true;
      else this.refreshAgain = true;
      return this.loading;
    }
    this.loading = (async () => {
      let next = more;
      while (!this.disposed) {
        await this.read(next);
        if (this.refreshAgain) { this.refreshAgain = false; next = false; }
        else if (this.loadMoreAgain) { this.loadMoreAgain = false; next = true; }
        else break;
      }
    })().finally(() => { this.loading = undefined; });
    return this.loading;
  }

  async read(more) {
    if (more && !this.cursor) return;
    const revision = this.scopeRevision;
    const readStartedAt = Date.now();
    const cwd = this.tabs.filterProject ? vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) : null;
    const pages = more ? 1 : this.loadedPages;
    const firstCursor = more ? this.cursor : null;
    for (const view of this.views) view.description = t("Loading…");
    try {
      const client = await this.createClient();
      this.client = client;
      if (this.disposed) { client.dispose(); return; }
      const readHistory = async () => {
        const data = new Map();
        let cursor = firstCursor, count = 0;
        do {
          const page = await client.list({ cursor, cwd: cwd?.length ? cwd : null });
          if (this.disposed || revision !== this.scopeRevision) return;
          for (const thread of page.data) data.set(thread.id, thread);
          cursor = page.nextCursor;
          ++count;
        } while (cursor && count < pages);
        return { data: [...data.values()], nextCursor: cursor, pages: count };
      };
      const [history, usage] = await Promise.allSettled([
        readHistory(),
        client.rateLimits(),
      ]);
      if (this.disposed || revision !== this.scopeRevision) return;
      this.historyError = history.status === 'rejected' ? history.reason.message : undefined;
      this.usageError = usage.status === 'rejected' ? usage.reason.message : undefined;
      if (history.status === 'fulfilled') {
        this.actions.scheduleTitles(history.value.data, readStartedAt);
        const old = more ? this.threads : [];
        const ids = new Set(old.map(thread => thread.id));
        this.threads = [...old, ...history.value.data.filter(thread => !ids.has(thread.id))];
        this.cursor = history.value.nextCursor;
        this.loadedPages = (more ? this.loadedPages : 0) + history.value.pages;
      }
      if (usage.status === 'fulfilled') {
        this.usage = usage.value;
        this.usageUpdatedAt = Date.now();
      }
      this.updatedAt = Date.now();
    } catch (error) {
      if (!this.disposed && revision === this.scopeRevision) this.historyError = this.usageError = error.message;
    } finally {
      this.client?.dispose();
      this.client = undefined;
      if (!this.disposed) {
        this.views[0].description = undefined;
        this.renderUsage();
        void vscode.commands.executeCommand('setContext', 'codexSessionTabs.projectOnly', this.tabs.filterProject);
        this.changed.fire();
      }
    }
  }

  updateLanguage() {
    for (const view of this.views) {
      view.title = t('Chats');
      view.message = undefined;
      view.description = this.loading ? t('Loading…') : undefined;
    }
    if (this.usageView) this.usageView.title = t('Usage');
    this.renderUsage();
    this.changed.fire();
  }

  renderUsage() {
    if (this.usageView) this.usageView.webview.html = usageHtml(this.usage, this.usageUpdatedAt, this.usageError);
  }

  sessionRoots() {
    const roots = [];
    const matches = thread => !this.query || `${title(thread)} ${thread.cwd || ''} ${thread.id}`.toLocaleLowerCase().includes(this.query.toLocaleLowerCase());
    const open = this.tabs.openTabs();
    const metadata = new Map([...this.tabs.pins, ...this.threads].map(thread => [thread.id, thread]));
    const used = new Set();
    const add = (label, children, icon) => { if (children.length) roots.push(group(label, children, icon)); };
    add(t("Open"), open.flatMap(entry => {
      const thread = metadata.get(entry.id) || entry.thread;
      if (this.query && !(thread ? matches(thread) : entry.label.toLocaleLowerCase().includes(this.query.toLocaleLowerCase()))) return [];
      used.add(entry.id);
      return [{ kind: 'session', thread, uri: entry.uri, label: thread ? title(thread) : entry.label, open: true }];
    }), 'files');
    const workspacePaths = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) || [];
    const matchesProject = this.tabs.filterProject && workspacePaths.length ? projectFilter(workspacePaths) : () => true;
    add(t("Pinned"), this.tabs.pins.flatMap(saved => {
      const thread = metadata.get(saved.id) || saved;
      if (used.has(thread.id) || !matches(thread) || !matchesProject(thread.cwd)) return [];
      used.add(thread.id);
      return [{ kind: 'session', thread, label: title(thread) }];
    }), 'pinned');
    const history = this.threads.filter(thread => !used.has(thread.id) && matches(thread) && matchesProject(thread.cwd));
    const session = thread => ({ kind: 'session', label: title(thread), thread });
    if (!this.tabs.filterProject) {
      for (const project of groupProjects(history)) roots.push({
        ...group(project.label, project.threads.map(session), 'folder'),
        label: project.name, projectDescription: project.parentLabel,
        // Search results must not inherit a manually collapsed project's state.
        id: `project:${project.key}${this.query ? ':search:' + encodeURIComponent(this.query) : ''}`, project: true,
        expanded: Boolean(this.query), tooltip: project.cwd || project.label,
      });
    } else {
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      const yesterday = new Date(midnight); yesterday.setDate(yesterday.getDate() - 1);
      const byDate = new Map([t("Today"), t("Yesterday"), t("Earlier")].map(label => [label, []]));
      for (const thread of history) {
        const label = thread.updatedAt * 1000 >= midnight ? t("Today") : thread.updatedAt * 1000 >= yesterday ? t("Yesterday") : t("Earlier");
        byDate.get(label).push(session(thread));
      }
      for (const [label, children] of byDate) add(label, children, 'history');
    }
    if (this.historyError) roots.unshift({ ...info(t("Could not refresh history"), t('Retry'), 'warning'),
      kind: 'retryHistory', tooltip: this.historyError });
    if (!roots.length) {
      if (!this.updatedAt) roots.push(info(t("Open the panel to load history")));
      else if (this.query) roots.push({ ...info(t('No matching chats'), t('Clear search'), 'search'), kind: 'clearSearch' });
      else if (this.tabs.filterProject) roots.push({ ...info(t('No chats in this project'), t('Show all projects'), 'folder'), kind: 'allProjects' });
      else roots.push({ ...info(t('No chats yet'), t('Create a chat'), 'comment'), kind: 'newChat' });
    }
    if (this.cursor) roots.push({ kind: 'more', label: t("Load more sessions"), icon: 'chevron-down' });
    if (this.query) roots.unshift(info(t("Search"), this.query, 'search'));
    roots.unshift({ kind: 'scope', label: this.tabs.filterProject ? t('This project') : t('All projects'),
      description: t('Switch'), icon: 'filter',
      tooltip: this.tabs.filterProject ? t('Show sessions from all projects') : t('Show the current project only') });
    return roots;
  }

  usageRoots() {
    const roots = [];
    if (this.usageError) roots.push(info(t("Could not refresh usage"), this.usageError, 'warning'));
    for (const bucket of quotaBuckets(this.usage)) {
      const children = [];
      if (bucket.plan) children.push(info(t("Plan"), bucket.plan, 'account'));
      for (const window of bucket.windows) {
        const percent = value => new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(value);
        const node = info(t('{window}: {remaining}% remaining', { window: window.label, remaining: percent(window.remaining) }), t('{used}% used', { used: percent(window.used) }), window.remaining <= 10 ? 'warning' : 'dashboard');
        node.tooltip = t('{used}% used. {remaining}% remaining.', { used: percent(window.used), remaining: percent(window.remaining) }) +
          (window.resetsAt ? '\n' + t('Resets: {date}', { date: date(window.resetsAt) }) : '');
        if (window.resetsAt) node.children = [info(t("Usage resets"), date(window.resetsAt), 'clock')];
        children.push(node);
      }
      if (bucket.credits?.unlimited) children.push(info(t("Extra credits"), t("unlimited"), 'credit-card'));
      else if (bucket.credits?.hasCredits && bucket.credits.balance !== null && bucket.credits.balance !== undefined) {
        children.push(info(t("Credit balance"), String(bucket.credits.balance), 'credit-card'));
      }
      if (!bucket.windows.length) children.push(info(t("The service returned no usage windows")));
      roots.push({ ...group(bucket.name, children, 'pulse'), id: `quota:${bucket.id}` });
    }
    if (!roots.length) roots.push(info(this.updatedAt ? t("The service returned no usage limits") : t("Open the panel to load usage")));
    if (this.usageUpdatedAt) roots.push(info(t("Updated"), new Date(this.usageUpdatedAt).toLocaleTimeString(locale()), 'sync'));
    return roots;
  }

  treeItem(node) {
    const item = new vscode.TreeItem(node.label, node.children?.length ?
      (node.kind === 'group' && (!node.project || node.expanded) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed) : vscode.TreeItemCollapsibleState.None);
    item.description = node.description;
    if (node.kind === 'group') {
      item.id = node.id || `group:${node.label}`;
      item.description = [String(node.children.length), node.projectDescription].filter(Boolean).join(' · ');
    }
    item.tooltip = node.tooltip || node.description || node.label;
    if (node.kind !== 'group' || node.project) item.iconPath = new vscode.ThemeIcon(node.icon || 'comment');
    if (node.kind === 'session') {
      item.id = `session:${node.thread?.id || node.uri.toString()}`;
      const pinned = this.tabs.isPinned(node.thread?.id);
      item.contextValue = `${node.thread ? 'codexSession' : 'codexDraft'}-${node.open ? 'open' : 'closed'}-${pinned ? 'pinned' : 'unpinned'}`;
      item.description = node.open ? t("open") : shortDate(node.thread?.updatedAt);
      item.tooltip = [node.label, node.thread?.cwd, node.thread?.updatedAt ? t('Updated: {date}', { date: date(node.thread.updatedAt) }) : ''].filter(Boolean).join('\n');
      item.accessibilityInformation = { label: [node.label, node.open ? t("open") : '', node.thread?.cwd ? t('Project {project}', { project: projectName(node.thread.cwd) }) : ''].filter(Boolean).join(', ') };
      item.iconPath = new vscode.ThemeIcon(pinned ? 'pinned' : node.open ? 'comment-discussion' : 'comment',
        node.open ? new vscode.ThemeColor('textLink.foreground') : undefined);
      item.command = { command: 'codexSessionTabs.sidebar.open', title: t("Open chat in a tab"), arguments: [node] };
    } else if (node.kind === 'more') item.command = { command: 'codexSessionTabs.loadMore', title: node.label };
    else {
      const command = { scope: 'codexSessionTabs.toggleProject', retryHistory: 'codexSessionTabs.refresh', clearSearch: 'codexSessionTabs.clearSearch',
        allProjects: 'codexSessionTabs.toggleProject', newChat: 'codexSessionTabs.newChat' }[node.kind];
      if (command) item.command = { command, title: node.description || node.label };
      if (node.kind === 'scope') {
        item.id = 'scope';
        item.accessibilityInformation = { label: `${node.label}. ${node.tooltip}` };
      }
    }
    return item;
  }

  async open(node, beside = false) {
    if (node.uri) await this.actions.reveal(node.uri, beside);
    else if (node.thread) await this.actions.open(node.thread.id, beside, node.thread);
  }

  async search() {
    const value = await vscode.window.showInputBox({ title: t("Search Codex sessions"), prompt: t("Title, project folder, or ID in loaded sessions"), value: this.query });
    if (value !== undefined) await this.setSearch(value);
  }

  async setSearch(value) {
    this.query = value.trim();
    await vscode.commands.executeCommand('setContext', 'codexSessionTabs.searchActive', Boolean(this.query));
    this.changed.fire();
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    this.client?.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }
}

module.exports = { Sidebar };
