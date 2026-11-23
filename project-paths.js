'use strict';

const fs = require('node:fs');
const path = require('node:path');

function windowsPath(value) {
  let windows = value.replace(/\\/g, '/');
  if (/^\/\/\?\/UNC\//i.test(windows)) windows = '//' + windows.slice(8);
  else if (/^\/\/\?\/[a-z]:\//i.test(windows)) windows = windows.slice(4);
  if (/^[a-z]:\//i.test(windows) || /^\/\/[^/]+\/[^/]+/.test(windows)) {
    return path.win32.normalize(windows);
  }
  return undefined;
}

function projectKey(value) {
  if (typeof value !== 'string' || !value) return undefined;
  // Detect the path's syntax rather than the extension host's OS (remote history).
  const windows = windowsPath(value);
  if (windows) return 'win:' + windows.replace(/\\+$/, '').toLowerCase();
  // Backslashes and case are meaningful in a POSIX path.
  if (value.startsWith('/')) return 'posix:' + (path.posix.normalize(value).replace(/\/+$/, '') || '/');
  return undefined;
}

function createProjectKey() {
  if (process.platform !== 'win32') return projectKey;
  // Cache only for the current history query or render so links can be retargeted.
  const keys = new Map();
  return value => {
    const key = projectKey(value);
    // Keep UNC history comparable without opening possibly offline shares.
    if (!key || !/^win:[a-z]:/.test(key)) return key;
    if (!keys.has(key)) {
      let resolved = key;
      try {
        resolved = projectKey(fs.realpathSync.native(windowsPath(value))) || key;
      } catch {
        // A historical folder may be gone, unavailable, or on a different host.
      }
      keys.set(key, resolved);
    }
    return keys.get(key);
  };
}

function projectFilter(folders) {
  const keyFor = createProjectKey();
  const keys = new Set(folders.map(keyFor));
  keys.delete(undefined);
  return cwd => keys.has(keyFor(cwd));
}

function inProject(cwd, folders) {
  return projectFilter(folders)(cwd);
}

module.exports = { projectKey, createProjectKey, projectFilter, inProject };
