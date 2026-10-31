'use strict';
const assert = require('node:assert/strict');
const { projectKey, inProject } = require('../project-paths');
const { HistoryClient } = require('../app-server');

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
}
run().catch(error => { console.error(error); process.exitCode = 1; });
