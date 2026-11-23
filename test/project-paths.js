'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { projectKey, inProject } = require('../project-paths');
const { HistoryClient } = require('../app-server');
const { groupProjects } = require('../session-projects');

async function windowsLinks() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'threadshelf-paths-'));
  try {
    const parent = path.join(root, 'physical');
    const physical = path.join(parent, 'Project');
    const child = path.join(physical, 'child');
    const sibling = path.join(parent, 'Project-old');
    fs.mkdirSync(child, { recursive: true });
    fs.mkdirSync(sibling);

    const junction = path.join(root, 'short');
    fs.symlinkSync(parent, junction, 'junction');
    const alias = path.join(junction, 'Project');
    const symlink = path.join(root, 'linked-project');
    let hasSymlink = true;
    try {
      fs.symlinkSync(physical, symlink, 'dir');
    } catch (error) {
      if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
      hasSymlink = false;
      console.log('SKIP: Windows directory symbolic link creation requires permission');
    }

    const dangling = path.join(root, 'dangling');
    fs.symlinkSync(path.join(root, 'missing'), dangling, 'junction');
    assert.ok(inProject(dangling, [dangling.toUpperCase()]));
    assert.ok(!inProject(dangling, [physical]));
    assert.ok(inProject(alias, [physical]));
    assert.ok(inProject(physical, [path.toNamespacedPath(alias)]));
    assert.ok(!inProject(child, [alias]));
    assert.ok(!inProject(path.join(junction, 'Project-old'), [physical]));

    const threads = [
      { id: 'junction', cwd: alias, updatedAt: 5 },
      { id: 'physical', cwd: physical, updatedAt: 4 },
      { id: 'child', cwd: child, updatedAt: 2 },
      { id: 'sibling', cwd: sibling, updatedAt: 1 },
    ];
    const expected = ['junction', 'physical'];
    if (hasSymlink) {
      assert.ok(inProject(symlink, [physical]));
      assert.ok(inProject(physical, [symlink]));
      threads.splice(2, 0, { id: 'symlink', cwd: symlink, updatedAt: 3 });
      expected.push('symlink');
    }

    const client = new HistoryClient('unused', physical);
    client.start = async () => {};
    client.request = async () => ({ data: threads, nextCursor: null });
    assert.deepEqual((await client.list({ cwd: [alias] })).data.map(thread => thread.id), expected);
    assert.deepEqual((await client.list({ cwd: [physical] })).data.map(thread => thread.id), expected);

    const groups = groupProjects(threads);
    assert.deepEqual(groups.map(group => group.threads.map(thread => thread.id)), [expected, ['child'], ['sibling']]);
    assert.equal(groups[0].cwd, alias);
    assert.equal(groups[0].key, groupProjects([threads[1]])[0].key);
    console.log(`PASS: Windows junction${hasSymlink ? ' and symbolic link' : ''} history filtering, grouping and fallback`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function run() {
  const folder = 'c:\\Users\\Alice\\My Project';
  for (const cwd of ['C:/users/ALICE/My Project/', 'c:\\Users\\Alice\\My Project\\',
    '\\\\?\\C:\\Users\\Alice\\My Project', 'C:/Users/Alice/work/../My Project']) {
    assert.ok(inProject(cwd, [folder]), cwd);
  }
  for (const cwd of ['C:/Users/Alice/My Project-old', 'C:/Users/Alice/My Project/child',
    'D:/Users/Alice/My Project', '/mnt/c/Users/Alice/My Project', undefined, '']) {
    assert.ok(!inProject(cwd, [folder]), String(cwd));
  }
  assert.ok(inProject('\\\\?\\UNC\\Server\\Share\\Project\\', ['//server/share/project']));
  assert.ok(!inProject('//server/other/project', ['//server/share/project']));
  assert.ok(inProject('C:/', ['c:\\']));
  assert.ok(inProject('/home/Alice/project/', ['/home/Alice/project']));
  assert.ok(!inProject('/home/alice/project', ['/home/Alice/project']));
  assert.ok(!inProject('/tmp/back\\slash', ['/tmp/back/slash']));
  assert.notEqual(projectKey('/'), projectKey('C:/'));
  assert.ok(inProject('D:/second', [folder, 'd:\\Second\\']));

  const client = new HistoryClient('unused', process.cwd());
  client.start = async () => {};
  const calls = [];
  client.request = async (method, params) => {
    calls.push({ method, params });
    assert.ok(!('cwd' in params), 'The backend must not discard alternate spellings');
    if (!params.cursor) return { data: [{ id: 'unrelated', cwd: 'C:/other' }], nextCursor: 'page2' };
    if (params.cursor === 'page2') return { data: [{ id: 'match', cwd: 'C:/USERS/alice/My Project/' },
      { id: 'neighbor', cwd: folder + '-old' }], nextCursor: 'page3' };
    return { data: [{ id: 'second', cwd: 'D:/SECOND/' }], nextCursor: null };
  };
  const first = await client.list({ cwd: [folder, 'd:\\second'] });
  assert.deepEqual(first.data.map(t => t.id), ['match']);
  assert.equal(first.nextCursor, 'page3');
  assert.equal(calls.length, 2, 'Skip empty pages so older project sessions are discoverable');
  const second = await client.list({ cwd: [folder, 'D:/second'], cursor: first.nextCursor });
  assert.deepEqual(second.data.map(t => t.id), ['second']);
  assert.equal(second.nextCursor, null);
  assert.deepEqual((await client.list()).data.map(t => t.id), ['unrelated']);
  assert.deepEqual((await client.list({ cwd: ['C:/missing'] })).data, []);
  client.request = async () => ({ data: [], nextCursor: 'repeated' });
  await assert.rejects(client.list({ cwd: [folder] }), /repeated history cursor/);
  console.log('PASS: Windows/UNC/extended paths, POSIX case, exact project roots and filtered pagination');
  if (process.platform === 'win32') await windowsLinks();
}
run().catch(error => { console.error(error); process.exitCode = 1; });
