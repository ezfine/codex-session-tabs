'use strict';

const path = require('node:path');

function projectKey(value) {
  if (typeof value !== 'string' || !value) return undefined;
  // Detect the path's syntax rather than the extension host's OS (remote history).
  let windows = value.replace(/\\/g, '/');
  if (/^\/\/\?\/UNC\//i.test(windows)) windows = '//' + windows.slice(8);
  else if (/^\/\/\?\/[a-z]:\//i.test(windows)) windows = windows.slice(4);
  if (/^[a-z]:\//i.test(windows) || /^\/\/[^/]+\/[^/]+/.test(windows)) {
    return 'win:' + path.win32.normalize(windows).replace(/\\+$/, '').toLowerCase();
  }
  // Backslashes and case are meaningful in a POSIX path.
  if (value.startsWith('/')) return 'posix:' + (path.posix.normalize(value).replace(/\/+$/, '') || '/');
  return undefined;
}

function inProject(cwd, folders) {
  const key = projectKey(cwd);
  return key !== undefined && folders.some(folder => projectKey(folder) === key);
}

module.exports = { projectKey, inProject };
