'use strict';

const { t, locale, language } = require('./i18n');

const { quotaBuckets } = require('./usage');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const percent = value => new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(value);
const clock = '<svg class="meta-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.5V8l2.5 1.5"/></svg>';
const refresh = '<svg class="meta-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M12.5 6a5 5 0 1 0 .2 3M12.5 2.5V6H9"/></svg>';

function usageHtml(result, updatedAt, error) {
  const sections = quotaBuckets(result).map(bucket => {
    const rows = bucket.windows.map(window => {
      const remaining = Math.min(100, Math.max(0, window.remaining));
      const reset = window.resetsAt ? t('Resets {date}', { date: new Date(window.resetsAt * 1000).toLocaleString(locale(), {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      }) }) : t("Reset time unavailable");
      const state = remaining <= 10 ? 'critical' : remaining <= 25 ? 'warning' : '';
      const summary = t('{window}: {remaining}% remaining, {used}% used', { window: window.label, remaining: percent(remaining), used: percent(window.used) });
      return `<div class="quota"><div class="row"><span class="label">${escape(window.label)}</span><span class="remaining"><strong>${percent(remaining)}%</strong> <span>${escape(t('remaining'))}</span></span></div><progress class="${state}" max="100" value="${remaining}" aria-label="${escape(summary)}" title="${escape(summary)}"></progress><div class="reset">${clock}<span>${escape(reset)}</span></div></div>`;
    }).join('');
    return `<section aria-label="${escape(bucket.name)}"${bucket.id === 'codex' && bucket.name === 'Codex' ? ' class="default-quota"' : ''}><div class="row account"><span>${escape(bucket.name)}</span>${bucket.plan ? `<span class="plan">${escape(bucket.plan)}</span>` : ''}</div>${rows || `<p class="empty">${escape(t('The service returned no usage windows'))}</p>`}</section>`;
  }).join('');
  return `<!DOCTYPE html><html lang="${language()}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>
:root{color-scheme:light dark}
body{margin:0;padding:9px 16px 10px;font:var(--vscode-font-size,13px)/1.35 var(--vscode-font-family,sans-serif);color:var(--vscode-sideBar-foreground,var(--vscode-foreground));background:var(--vscode-sideBar-background)}
.row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;min-width:0}
.account{margin-bottom:8px;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground)}
.plan{padding:1px 6px;border:1px solid var(--vscode-widget-border,var(--vscode-panel-border));border-radius:4px;font-size:10px;font-weight:400;text-transform:capitalize;line-height:1.2}
.quota+.quota{margin-top:11px}
.label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.remaining{display:inline-flex;align-items:baseline;gap:4px;flex-shrink:0;color:var(--vscode-descriptionForeground);font-size:11px;font-variant-numeric:tabular-nums}
.remaining strong{font-size:calc(var(--vscode-font-size,13px) + 2px);font-weight:600;line-height:1.2;color:var(--vscode-foreground)}
progress{display:block;appearance:none;-webkit-appearance:none;width:100%;height:5px;margin:5px 0;border:0;border-radius:3px;overflow:hidden;background:var(--vscode-widget-border,var(--vscode-input-background))}
progress::-webkit-progress-bar{background:var(--vscode-widget-border,var(--vscode-input-background));border-radius:3px}
progress::-webkit-progress-value{background:var(--vscode-progressBar-background);border-radius:3px}
progress.warning::-webkit-progress-value{background:var(--vscode-editorWarning-foreground)}
progress.critical::-webkit-progress-value{background:var(--vscode-errorForeground)}
.reset,.updated,.empty{font-size:11px;color:var(--vscode-descriptionForeground)}
.reset,.updated{display:flex;align-items:center;gap:5px;font-variant-numeric:tabular-nums}
.meta-icon{width:11px;height:11px;flex:none;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.updated{margin-top:8px}.error{color:var(--vscode-editorWarning-foreground);font-size:11px;margin:0 0 10px;overflow-wrap:anywhere}
section+section{border-top:1px solid var(--vscode-sideBarSectionHeader-border,var(--vscode-panel-border));margin-top:12px;padding-top:12px}
p{margin:6px 0}
body.vscode-high-contrast progress,body.vscode-high-contrast-light progress{outline:1px solid var(--vscode-contrastBorder)}
@media(max-width:210px){body{padding-inline:10px}.remaining{font-size:10px}.row{gap:6px}}
@media(max-height:160px){body{padding:6px 12px}section.default-quota:only-of-type .account{display:none}.quota+.quota{margin-top:7px}progress{height:3px;margin:4px 0}.remaining strong{font-size:var(--vscode-font-size,13px)}.updated{margin-top:6px}}
</style></head><body>${error ? `<p class="error" role="status">${escape(t('Could not refresh: {error}', { error }))}</p>` : ''}${sections || `<p class="empty" role="status">${error ? t("Usage unavailable") : updatedAt ? t("The service returned no usage limits") : t("Loading usage…")}</p>`}${updatedAt ? `<div class="updated">${refresh}<span>${escape(t('Updated {time}', { time: new Date(updatedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) }))}</span></div>` : ''}</body></html>`;
}

module.exports = { usageHtml };
