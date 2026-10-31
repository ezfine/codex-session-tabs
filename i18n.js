'use strict';

const russian = require('./i18n.ru.json');
let selection = () => 'auto';
let editorLanguage = () => 'en';

function configure(getSelection, getEditorLanguage) {
  selection = getSelection;
  editorLanguage = getEditorLanguage;
}
function language() {
  const chosen = selection();
  if (chosen === 'en' || chosen === 'ru') return chosen;
  return /^ru(?:[-_]|$)/i.test(editorLanguage() || '') ? 'ru' : 'en';
}
function locale() { return language() === 'ru' ? 'ru-RU' : 'en-US'; }
function t(message, values = {}) {
  const translated = language() === 'ru' ? russian[message] ?? message : message;
  return translated.replace(/\{(\w+)\}/g, (placeholder, key) => Object.hasOwn(values, key) ? String(values[key]) : placeholder);
}
// Stored titles are user data. Switching UI language never rewrites them.
function isPlaceholder(name) { return ['New chat', 'Новый чат'].includes(name?.trim()); }

module.exports = { configure, language, locale, t, isPlaceholder };
