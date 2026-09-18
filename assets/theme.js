'use strict';
(() => {
  const key = 'actsAppearanceThemeV1';
  const valid = new Set(['system', 'light', 'dark']);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let choice = 'system';
  try {
    const stored = localStorage.getItem(key);
    if (valid.has(stored)) choice = stored;
  } catch (_) {}

  function apply() {
    const effective = choice === 'system' ? (media.matches ? 'dark' : 'light') : choice;
    document.documentElement.dataset.theme = effective;
    document.documentElement.style.colorScheme = effective;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = effective === 'dark' ? '#111c2d' : '#0f3d91';
    window.dispatchEvent(new CustomEvent('acts:theme', { detail: { choice, effective } }));
  }

  function set(next) {
    if (!valid.has(next)) return;
    choice = next;
    try { localStorage.setItem(key, choice); } catch (_) {}
    apply();
  }

  media.addEventListener('change', () => { if (choice === 'system') apply(); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    choice = valid.has(event.newValue) ? event.newValue : 'system';
    apply();
  });
  window.__ACTS_THEME__ = { get choice() { return choice; }, get effective() { return document.documentElement.dataset.theme; }, set };
  apply();
})();
