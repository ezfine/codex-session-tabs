'use strict';

const { t } = require('./i18n');

function durationLabel(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return t("Usage window");
  if (minutes === 10080) return t("Week");
  if (minutes % 1440 === 0) return t('{count} d', { count: minutes / 1440 });
  if (minutes % 60 === 0) return t('{count} h', { count: minutes / 60 });
  return t('{count} min', { count: minutes });
}

function quotaBuckets(result) {
  const map = result?.rateLimitsByLimitId;
  const entries = map && Object.keys(map).length ? Object.entries(map) :
    result?.rateLimits ? [[result.rateLimits.limitId || 'codex', result.rateLimits]] : [];
  return entries.filter(([, value]) => value && typeof value === 'object').map(([id, bucket]) => ({
    id,
    name: bucket.limitName || (id === 'codex' ? 'Codex' : id),
    plan: bucket.planType,
    credits: bucket.credits,
    windows: ['primary', 'secondary'].flatMap(key => {
      const window = bucket[key];
      if (!window || !Number.isFinite(window.usedPercent)) return [];
      const used = window.usedPercent;
      const remaining = Math.max(0, 100 - used);
      return [{ key, label: durationLabel(window.windowDurationMins), minutes: window.windowDurationMins, used, remaining,
        resetsAt: Number.isFinite(window.resetsAt) ? window.resetsAt : null }];
    }),
  })).sort((a, b) => (a.id === 'codex' ? -1 : b.id === 'codex' ? 1 : a.name.localeCompare(b.name)));
}

module.exports = { quotaBuckets, durationLabel };
