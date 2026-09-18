'use strict';
(() => {
  const ACKNOWLEDGED_KEY = 'actsReleaseAcknowledgedV2';
  const BASELINE_KEY = 'actsReleaseBaselineV2';
  const NOTICE_PENDING_KEY = 'actsReleaseNoticePendingV2';
  const PWA_UPDATE_KEY = 'actsPwaUpdatePendingV2';
  const PRIOR_DATA_KEYS = ['actsWorkspaceDataV1', 'actsWorkspacePreferencesV1', 'actsGeneratorSettingsV10', 'actsGeneratorSettingsV9'];
  let returningVisitor = Boolean(navigator.serviceWorker?.controller);
  try { returningVisitor ||= PRIOR_DATA_KEYS.some(key => localStorage.getItem(key) !== null); } catch (_) {}

  document.addEventListener('DOMContentLoaded', () => {
    const version = window.__ACTS_TEST_API__?.APP_VERSION;
    if (!version) return;

    const modal = document.getElementById('infoModal');
    const scroll = document.getElementById('infoScroll');
    const title = document.getElementById('infoDialogTitle');
    const subtitle = document.getElementById('infoDialogSubtitle');
    const news = document.getElementById('infoNewsView');
    const about = document.getElementById('infoAboutView');
    const historyButton = document.getElementById('infoHistoryBtn');
    const backButton = document.getElementById('infoBackBtn');
    const doneButton = document.getElementById('infoDoneBtn');
    let opener = null;
    let fromNews = false;
    let contentPromise;

    function stored(key) {
      try { return localStorage.getItem(key) || sessionStorage.getItem(key); }
      catch (_) { try { return sessionStorage.getItem(key); } catch (_) { return null; } }
    }

    function remember(key, value) {
      try { localStorage.setItem(key, value); } catch (_) {}
      try { sessionStorage.setItem(key, value); } catch (_) {}
    }

    function forget(key) {
      try { localStorage.removeItem(key); } catch (_) {}
      try { sessionStorage.removeItem(key); } catch (_) {}
    }

    function markRead() {
      remember(ACKNOWLEDGED_KEY, version);
      forget(NOTICE_PENDING_KEY);
      try { sessionStorage.removeItem(PWA_UPDATE_KEY); } catch (_) {}
    }

    function parseReadme(markdown) {
      const document = { introduction: [], sections: [], versions: [] };
      let section = null;
      let release = null;
      for (const source of markdown.split(/\r?\n/)) {
        const line = source.trim().replace(/`/g, '');
        if (!line || line.startsWith('# ')) continue;
        if (line.startsWith('## ')) {
          section = { title: line.slice(3), paragraphs: [], bullets: [] };
          document.sections.push(section);
          release = null;
        } else if (line.startsWith('### ') && section?.title === 'История версий') {
          release = { title: line.slice(4), bullets: [] };
          document.versions.push(release);
        } else if (line.startsWith('- ')) {
          if (release) release.bullets.push(line.slice(2));
          else if (section) section.bullets.push(line.slice(2));
        } else if (section && !release) section.paragraphs.push(line);
        else if (!section) document.introduction.push(line);
      }
      return document;
    }

    function element(tag, text, className) {
      const node = document.createElement(tag);
      if (text) node.textContent = text;
      if (className) node.className = className;
      return node;
    }

    function appendList(parent, items) {
      if (!items.length) return;
      const list = element('ul');
      for (const item of items) list.append(element('li', item));
      parent.append(list);
    }

    function render(readme) {
      const release = readme.versions.find(item => item.title.startsWith(`${version} - `));
      if (!release) throw new Error('Current release is missing from README');
      news.replaceChildren();
      news.append(element('p', 'Главные изменения этого выпуска:', 'info-intro'));
      appendList(news, release.bullets);

      about.replaceChildren();
      for (const paragraph of readme.introduction) about.append(element('p', paragraph, 'info-intro'));
      for (const section of readme.sections) {
        const heading = element('h3', section.title);
        if (section.title === 'История версий') heading.id = 'infoHistoryHeading';
        about.append(heading);
        for (const paragraph of section.paragraphs) about.append(element('p', paragraph));
        appendList(about, section.bullets);
        if (section.title !== 'История версий') continue;
        for (const [index, item] of readme.versions.entries()) {
          const details = element('details', '', 'info-release');
          if (index === 0) details.open = true;
          details.append(element('summary', item.title));
          appendList(details, item.bullets);
          about.append(details);
        }
      }
      return release.title;
    }

    function loadContent() {
      if (!contentPromise) {
        contentPromise = fetch('./README.md').then(response => {
          if (!response.ok) throw new Error('README unavailable');
          return response.text();
        }).then(text => render(parseReadme(text))).catch(() => {
          contentPromise = null;
          return null;
        });
      }
      return contentPromise;
    }

    function showView(view, scrollToHistory = false) {
      const isNews = view === 'news';
      news.hidden = !isNews;
      about.hidden = isNews;
      title.textContent = isNews ? 'Что нового?' : 'О сервисе';
      subtitle.textContent = isNews ? `Версия ${version}` : 'Конструктор актов сдачи-приемки';
      historyButton.hidden = !isNews;
      backButton.hidden = isNews || !fromNews;
      scroll.scrollTop = 0;
      if (scrollToHistory) requestAnimationFrame(() => {
        const heading = document.getElementById('infoHistoryHeading');
        if (!heading) return;
        scroll.scrollTop = heading.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 8;
      });
    }

    async function open(view, automatic = false) {
      if (!modal.hidden) return;
      const releaseTitle = await loadContent();
      if (!releaseTitle && automatic) return;
      if (!releaseTitle) {
        const message = element('p', 'Описание сейчас недоступно. Попробуйте открыть его позже.');
        news.replaceChildren(message);
        about.replaceChildren(message.cloneNode(true));
      }
      opener = automatic ? null : document.activeElement;
      fromNews = view === 'news';
      showView(view);
      if (releaseTitle && view === 'news') subtitle.textContent = `Версия ${releaseTitle}`;
      modal.hidden = false;
      document.body.classList.add('info-open');
      doneButton.focus({ preventScroll: true });
    }

    function close() {
      if (modal.hidden) return;
      modal.hidden = true;
      document.body.classList.remove('info-open');
      if (fromNews) markRead();
      const target = opener?.isConnected ? opener : document.getElementById('executorPickerButton');
      target?.focus({ preventScroll: true });
      opener = null;
    }

    document.getElementById('aboutServiceBtn').addEventListener('click', () => open('about'));
    historyButton.addEventListener('click', () => showView('about', true));
    backButton.addEventListener('click', () => showView('news'));
    doneButton.addEventListener('click', close);
    modal.querySelector('[data-close-info]').addEventListener('click', close);
    document.addEventListener('keydown', event => {
      if (modal.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...modal.querySelectorAll('button:not([disabled])')].filter(node => !node.hidden && !node.closest('[hidden]') && node.getClientRects().length);
      if (!controls.length) return;
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }, true);

    const baseline = stored(BASELINE_KEY);
    const acknowledged = stored(ACKNOWLEDGED_KEY);
    const pwaUpdateRequested = (() => { try { return sessionStorage.getItem(PWA_UPDATE_KEY) === '1'; } catch (_) { return false; } })();
    if (baseline !== version) remember(BASELINE_KEY, version);
    if (acknowledged === version) {
      forget(NOTICE_PENDING_KEY);
      try { sessionStorage.removeItem(PWA_UPDATE_KEY); } catch (_) {}
      return;
    }
    if ((baseline === null && returningVisitor) || (baseline !== null && baseline !== version) || pwaUpdateRequested) {
      remember(NOTICE_PENDING_KEY, version);
    }
    if (stored(NOTICE_PENDING_KEY) !== version) return;
    const showWhenVisible = () => {
      if (document.visibilityState === 'visible') open('news', true);
      else document.addEventListener('visibilitychange', showWhenVisible, { once: true });
    };
    window.setTimeout(showWhenVisible, 450);
  }, { once: true });
})();
