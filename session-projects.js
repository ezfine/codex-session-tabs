'use strict';

const path = require('node:path');
const { t } = require('./i18n');
const { projectKey } = require('./project-paths');

const updated = thread => Number.isFinite(thread.updatedAt) ? thread.updatedAt : 0;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function projectName(cwd) {
  if (!cwd) return t('No project');
  const syntax = projectKey(cwd)?.startsWith('win:') ? path.win32 : path.posix;
  return syntax.basename(syntax.normalize(cwd)) || cwd;
}

function groupProjects(threads) {
  const projects = new Map();
  for (const thread of threads) {
    const key = projectKey(thread.cwd) || (thread.cwd ? `raw:${thread.cwd}` : 'none');
    if (!projects.has(key)) projects.set(key, { key, threads: [] });
    projects.get(key).threads.push(thread);
  }
  const groups = [...projects.values()];
  const names = new Map();
  for (const group of groups) {
    group.threads.sort((a, b) => updated(b) - updated(a) || compare(a.id, b.id));
    group.cwd = group.threads[0].cwd || '';
    group.label = projectName(group.cwd);
    group.name = group.label;
    const name = group.label.toLowerCase();
    names.set(name, (names.get(name) || 0) + 1);
  }
  // Show the nearest useful parent, rather than a full path that gets truncated.
  for (const group of groups) {
    if (names.get(group.label.toLowerCase()) <= 1 || !group.cwd) continue;
    const syntax = group.key.startsWith('win:') ? path.win32 : path.posix;
    const parent = syntax.dirname(syntax.normalize(group.cwd));
    const suffix = syntax.basename(parent) || parent;
    const ambiguous = groups.some(other => {
      if (other === group || projectName(other.cwd).toLowerCase() !== projectName(group.cwd).toLowerCase()) return false;
      const otherSyntax = other.key.startsWith('win:') ? path.win32 : path.posix;
      const otherParent = otherSyntax.dirname(otherSyntax.normalize(other.cwd));
      return (otherSyntax.basename(otherParent) || otherParent).toLowerCase() === suffix.toLowerCase();
    });
    group.parentLabel = ambiguous ? parent : suffix;
    group.label += ` — ${group.parentLabel}`;
  }
  return groups.sort((a, b) => updated(b.threads[0]) - updated(a.threads[0]) || compare(a.key, b.key));
}

module.exports = { groupProjects, projectName };
