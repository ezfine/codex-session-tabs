'use strict';
require('../i18n').configure(() => 'ru', () => 'en');
const assert = require('node:assert/strict');
const { quotaBuckets } = require('../usage');

assert.deepEqual(quotaBuckets(null), []);
const [weekly] = quotaBuckets({ rateLimits: { limitId: 'codex', primary: {
  usedPercent: 23.5, windowDurationMins: 10080, resetsAt: 1234567890,
}, secondary: null } });
assert.equal(weekly.windows.length, 1, 'Do not invent an absent second window');
assert.equal(weekly.windows[0].remaining, 76.5);
assert.equal(weekly.windows[0].label, 'Неделя');
const buckets = quotaBuckets({ rateLimitsByLimitId: {
  code_review: { limitName: 'Code review', primary: { usedPercent: 101, windowDurationMins: 60 } },
  codex: { primary: { usedPercent: 50, windowDurationMins: 300 }, secondary: { usedPercent: null } },
}, rateLimits: { primary: { usedPercent: 0 } } });
assert.equal(buckets.length, 2, 'Use the multi-bucket result without duplicating legacy data');
assert.equal(buckets[0].id, 'codex');
assert.equal(buckets[0].windows[0].label, '5 ч.');
assert.equal(buckets[0].windows.length, 1, 'Unknown percentage is not zero usage');
assert.equal(buckets[1].windows[0].remaining, 0);
console.log('PASS: actual quota windows, remaining usage, missing data and separate buckets');
const { usageHtml } = require('../usage-view');
const html = usageHtml({ rateLimits: { limitId: 'codex', planType: '<unsafe>', primary: { usedPercent: 25, windowDurationMins: 10080 } } }, Date.now());
assert.ok(html.includes('value="75"'));
assert.ok(!html.includes('5 ч.'), 'An unreported quota window is omitted');
assert.ok(html.includes('&lt;unsafe&gt;') && !html.includes('<unsafe>'));
const both = usageHtml({ rateLimits: { limitId: 'codex', primary: { usedPercent: 33, windowDurationMins: 300 }, secondary: { usedPercent: 10, windowDurationMins: 10080 } } });
assert.ok(!both.includes('Сервис не вернул это окно лимита'));
assert.equal((both.match(/<progress /g) || []).length, 2);
const emptyResponse = usageHtml({}, Date.now());
assert.ok(emptyResponse.includes('Нет данных о лимитах'));
assert.ok(!emptyResponse.includes('Загрузка лимитов'), 'A completed empty response is not an ongoing load');
console.log('PASS: quota progress bars, truthful five-hour placeholder and HTML escaping');
