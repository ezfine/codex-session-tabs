'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const { configure, language, locale, t, isPlaceholder } = require('../i18n');
const { usageHtml } = require('../usage-view');
const { durationLabel } = require('../usage');
const russian = require('../i18n.ru.json');
let selected = 'auto', editor = 'en';
configure(() => selected, () => editor);
for (const [host, expected] of [['en','en'],['ru','ru'],['ru-RU','ru'],['RU','ru'],['de','en'],['fr','en'],['','en']]) {
  editor = host; assert.equal(language(), expected);
}
editor = 'ru'; selected = 'en'; assert.equal(language(), 'en');
editor = 'en'; selected = 'ru'; assert.equal(language(), 'ru');
assert.equal(t('Project {project}', { project: '<project>{date}' }), 'Проект <project>{date}');
assert.equal(t('Missing translation'), 'Missing translation');
const data = { rateLimits: { limitId: 'codex', primary: { usedPercent: 23.5, windowDurationMins: 10080, resetsAt: 1900000000 } } };
for (const lang of ['en','ru']) {
  selected = lang;
  const html = usageHtml(data, 1900000000000, '<script>alert(1)</script>');
  assert.ok(html.includes(`lang="${lang}"`));
  assert.ok(html.includes(lang === 'ru' ? '76,5%' : '76.5%'));
  assert.ok(html.includes(lang === 'ru' ? 'Неделя' : 'Week'));
  assert.ok(html.includes('&lt;script&gt;') && !html.includes('<script>'));
  assert.equal(durationLabel(300), lang === 'ru' ? '5 ч.' : '5 h');
  assert.equal(locale(), lang === 'ru' ? 'ru-RU' : 'en-US');
  assert.equal(isPlaceholder('Новый чат'), true);
  assert.equal(isPlaceholder('New chat'), true);
  assert.equal(isPlaceholder('Custom title'), false);
}
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
for (const [english, translated] of Object.entries(russian)) assert.deepEqual(placeholders(translated), placeholders(english), english);
for (const file of fs.readdirSync(root).filter(n => n.endsWith('.js'))) {
  for (const match of fs.readFileSync(path.join(root,file),'utf8').matchAll(/\bt\((['"])(.*?)\1/g)) {
    assert.ok(Object.hasOwn(russian, match[2]), `${file}: missing translation for ${match[2]}`);
  }
}
const manifest = require('../package.json'), en = require('../package.nls.json'), ru = require('../package.nls.ru.json');
for (const [,key] of JSON.stringify(manifest).matchAll(/%([^%]+)%/g)) {
  assert.equal(typeof en[key], 'string', `Missing English manifest key ${key}`);
  assert.equal(typeof ru[key], 'string', `Missing Russian manifest key ${key}`);
}
assert.equal(manifest.contributes.configuration.properties['codexSessionTabs.language'].default, 'auto');
console.log('PASS: language detection, overrides, fallback, number/date locales, escaping, legacy placeholders and complete translation catalogs');
