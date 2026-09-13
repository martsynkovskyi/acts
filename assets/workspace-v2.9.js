'use strict';
(() => {
  const PREFS_KEY = 'actsWorkspacePreferencesV1';
  const DATA_KEY = 'actsWorkspaceDataV1';
  const INSTALLED_KEY = 'actsInstalledUnlimitedV1';
  const LEGACY_KEYS = ['actsGeneratorSettingsV9', 'actsGeneratorSettingsV10'];
  const DAY = 86400000;
  const fieldIds = ['executor', 'assocPosition', 'assocName', 'assocBasis', 'actDate', 'city', 'customer', 'contractNumber', 'contractDate', 'customerPosition', 'customerName', 'customerBasis', 'servicePlace', 'amount', 'serviceName'];
  const emptyFields = () => Object.fromEntries(fieldIds.map(id => [id, id === 'executor' ? 'rr' : '']));

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : fallback;
    } catch (_) {
      return fallback;
    }
  }

  let prefs = readJson(PREFS_KEY, {});
  prefs.storageEnabled = prefs.storageEnabled !== false;
  prefs.retentionDays = String(prefs.retentionDays) === 'always' ? 'always' : [30, 183, 365].includes(Number(prefs.retentionDays)) ? Number(prefs.retentionDays) : 30;
  prefs.defaults = prefs.defaults && typeof prefs.defaults === 'object' ? prefs.defaults : { city: '', servicePlace: '', dateMode: 'blank' };
  const standaloneNow = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standaloneNow) { try { localStorage.setItem(INSTALLED_KEY, '1'); } catch (_) {} }
  window.__ACTS_INSTALLED__ = standaloneNow || (() => { try { return localStorage.getItem(INSTALLED_KEY) === '1'; } catch (_) { return false; } })();
  window.__ACTS_STORAGE_ALLOWED__ = prefs.storageEnabled;
  window.__ACTS_RETENTION_DAYS__ = prefs.retentionDays;

  document.addEventListener('DOMContentLoaded', init, { once: true });

  function init() {
    const api = window.__ACTS_TEST_API__;
    if (!api) return;
    const fields = Object.fromEntries(fieldIds.map(id => [id, document.getElementById(id)]));
    const form = document.getElementById('actForm');
    const draftSelect = document.getElementById('draftSelect');
    const storageToggle = document.getElementById('storageEnabled');
    const retentionSelect = document.getElementById('retentionDays');
    const privacyText = document.getElementById('privacyText');
    let saveTimer = 0;
    let nameMode = 'new';
    let state = loadState(api.snapshot());
    const selectedLibrary = { customer: null, executorSigner: null, service: null };
    const executorPicker = document.querySelector('.executor-picker');
    const executorTrigger = document.getElementById('executorPickerButton');
    const executorOptions = document.getElementById('executorPickerOptions');
    const executorLabel = document.getElementById('executorPickerLabel');
    const executorValues = new Set(['rr', 'rrPoa', 'rrms', 'rrs']);

    function nowIso() { return new Date().toISOString(); }
    function todayLocal() { const date = new Date(); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
    function uid() { return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
    function normalize(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
    function currentDraft() { return state.drafts.find(draft => draft.id === state.activeDraftId) || state.drafts[0]; }
    function defaultFields() {
      const values = emptyFields();
      values.city = normalize(prefs.defaults.city);
      values.servicePlace = normalize(prefs.defaults.servicePlace);
      if (prefs.defaults.dateMode === 'today') values.actDate = todayLocal();
      return values;
    }
    function restore(values) {
      api.restore({ ...emptyFields(), ...(values || {}) });
      updateContractPlaceholder();
      syncExecutorPicker();
      refreshSemanticHints();
    }

    function syncExecutorPicker() {
      if (!executorTrigger || !executorOptions) return;
      const selectedOption = fields.executor.selectedOptions[0];
      executorLabel.textContent = selectedOption?.textContent || 'Ассоциация Русский Регистр';
      executorOptions.querySelectorAll('[role="option"]').forEach(option => option.setAttribute('aria-selected', option.dataset.value === fields.executor.value ? 'true' : 'false'));
    }

    function closeExecutorPicker({ focus = false } = {}) {
      if (!executorTrigger || !executorOptions) return;
      executorOptions.hidden = true;
      executorTrigger.setAttribute('aria-expanded', 'false');
      if (focus) executorTrigger.focus();
    }

    function openExecutorPicker() {
      if (!executorTrigger || !executorOptions) return;
      executorOptions.hidden = false;
      executorTrigger.setAttribute('aria-expanded', 'true');
      const selected = executorOptions.querySelector('[aria-selected="true"]') || executorOptions.querySelector('[role="option"]');
      selected?.focus();
    }

    function chooseExecutor(value) {
      if (!executorValues.has(value)) return;
      fields.executor.value = value;
      syncExecutorPicker();
      closeExecutorPicker({ focus: true });
      fields.executor.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function bindExecutorPicker() {
      if (!executorTrigger || !executorOptions || !executorPicker) return;
      const options = [...executorOptions.querySelectorAll('[role="option"]')];
      executorTrigger.addEventListener('click', () => executorOptions.hidden ? openExecutorPicker() : closeExecutorPicker());
      executorTrigger.addEventListener('keydown', event => {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); openExecutorPicker(); }
      });
      options.forEach((option, index) => {
        option.addEventListener('click', () => chooseExecutor(option.dataset.value));
        option.addEventListener('keydown', event => {
          if (event.key === 'Escape') { event.preventDefault(); closeExecutorPicker({ focus: true }); return; }
          if (event.key === 'Tab') { closeExecutorPicker(); return; }
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseExecutor(option.dataset.value); return; }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const target = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : event.key === 'ArrowDown' ? (index + 1) % options.length : (index - 1 + options.length) % options.length;
          options[target].focus();
        });
      });
      document.addEventListener('pointerdown', event => { if (!executorPicker.contains(event.target)) closeExecutorPicker(); });
      fields.executor.addEventListener('change', syncExecutorPicker);
      syncExecutorPicker();
    }
    function persistPrefs() {
      const safePrefs = { storageEnabled: prefs.storageEnabled, retentionDays: prefs.retentionDays };
      if (prefs.storageEnabled) safePrefs.defaults = prefs.defaults;
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(safePrefs)); } catch (_) {}
      window.__ACTS_STORAGE_ALLOWED__ = prefs.storageEnabled;
      window.__ACTS_RETENTION_DAYS__ = prefs.retentionDays;
    }
    function persistState() {
      if (!prefs.storageEnabled) return;
      state.updatedAt = nowIso();
      try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch (_) { toast('Не удалось сохранить рабочие данные.', 'error'); }
    }
    function saveCurrent(immediate = false) {
      clearTimeout(saveTimer);
      const run = () => {
        const draft = currentDraft();
        if (!draft) return;
        draft.fields = api.snapshot();
        draft.updatedAt = nowIso();
        persistState();
        renderDrafts();
      };
      if (immediate) run(); else saveTimer = setTimeout(run, 380);
    }
    function removeStoredData() {
      try {
        localStorage.removeItem(DATA_KEY);
        LEGACY_KEYS.forEach(key => localStorage.removeItem(key));
      } catch (_) {}
    }
    function loadState(current) {
      const stored = prefs.storageEnabled ? readJson(DATA_KEY, null) : null;
      const fresh = stored && (prefs.retentionDays === 'always' || (Date.parse(stored.updatedAt || '') && Date.now() - Date.parse(stored.updatedAt) <= Number(prefs.retentionDays) * DAY));
      if (fresh && Array.isArray(stored.drafts) && stored.drafts.length) {
        stored.customerCards = sanitizedCustomerCards(stored.customerCards, stored.drafts, stored.signerCards);
        stored.executorSignerCards = Array.isArray(stored.executorSignerCards) ? stored.executorSignerCards.map(card => ({ ...card, id: card.id || uid() })) : [];
        stored.serviceTemplates = Array.isArray(stored.serviceTemplates) ? stored.serviceTemplates : [];
        stored.version = 3;
        delete stored.recentServices;
        delete stored.signerCards;
        return stored;
      }
      if (stored) removeStoredData();
      let migrated = current;
      if (prefs.storageEnabled) {
        for (const key of LEGACY_KEYS) {
          const legacy = readJson(key, null);
          if (legacy?.fields) { migrated = { ...emptyFields(), ...legacy.fields }; break; }
        }
      }
      return { version: 3, updatedAt: nowIso(), activeDraftId: 'main', drafts: [{ id: 'main', name: 'Основной черновик', fields: migrated, updatedAt: nowIso() }], customerCards: [], executorSignerCards: [], serviceTemplates: [], lastAct: null };
    }
    function renderDrafts() {
      draftSelect.replaceChildren(...state.drafts.map(draft => new Option(draft.name, draft.id)));
      draftSelect.value = state.activeDraftId;
      const draft = currentDraft();
      document.getElementById('activeDraftLabel').textContent = draft?.name || 'Основной черновик';
      document.getElementById('deleteDraftBtn').disabled = state.drafts.length === 1;
    }
    function signerLabel(card) { return card.name; }
    const libraryConfigs = {
      customer: { inputId: 'customerCardSelect', optionsId: 'customerCardOptions', updateId: 'updateCustomerBtn', deleteId: 'deleteCustomerBtn', source: () => state.customerCards, key: item => item.id, primary: item => item.customer, secondary: item => [item.name, item.position].filter(Boolean).join(' - '), apply: item => { updateField('customer', item.customer); updateField('customerPosition', item.position); updateField('customerName', item.name); updateField('customerBasis', item.basis); fields.customer.dispatchEvent(new Event('input', { bubbles: true })); fields.customerName.dispatchEvent(new Event('input', { bubbles: true })); } },
      executorSigner: { inputId: 'executorSignerCardSelect', optionsId: 'executorSignerCardOptions', updateId: 'updateExecutorSignerBtn', deleteId: 'deleteExecutorSignerBtn', source: () => state.executorSignerCards, key: item => item.id, primary: item => item.name, secondary: () => '', apply: item => { updateField('assocPosition', item.position); updateField('assocName', item.name); updateField('assocBasis', item.basis); fields.assocName.dispatchEvent(new Event('input', { bubbles: true })); } },
      service: { inputId: 'serviceTemplateSelect', optionsId: 'serviceTemplateOptions', updateId: 'updateServiceBtn', deleteId: 'deleteServiceBtn', source: () => state.serviceTemplates, key: item => item, primary: item => item, secondary: () => '', apply: item => { updateField('serviceName', item); fields.serviceName.dispatchEvent(new Event('input', { bubbles: true })); } }
    };
    function libraryItem(kind, key) {
      const config = libraryConfigs[kind];
      return config.source().find(item => config.key(item) === key);
    }
    function libraryLabel(config, item) { return config.primary(item) + (config.secondary(item) ? ` - ${config.secondary(item)}` : ''); }
    function setLibraryButtons(kind) {
      const config = libraryConfigs[kind], exists = Boolean(libraryItem(kind, selectedLibrary[kind]));
      document.getElementById(config.updateId).disabled = !exists;
      document.getElementById(config.deleteId).disabled = !exists;
    }
    function closeLibrary(kind) {
      const config = libraryConfigs[kind], input = document.getElementById(config.inputId), options = document.getElementById(config.optionsId);
      options.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
    }
    function renderLibrary(kind, open = false) {
      const config = libraryConfigs[kind], input = document.getElementById(config.inputId), options = document.getElementById(config.optionsId);
      const query = normalize(input.value).toLocaleLowerCase('ru');
      const items = config.source().filter(item => libraryLabel(config, item).toLocaleLowerCase('ru').includes(query)).slice(0, 50);
      const children = items.map((item, index) => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'library-option'; button.setAttribute('role', 'option'); button.id = `${config.optionsId}-option-${index}`; button.dataset.active = 'false';
        const primary = document.createElement('span'); primary.className = 'library-option-primary'; primary.textContent = config.primary(item); button.appendChild(primary);
        const secondaryText = config.secondary(item);
        if (secondaryText) { const secondary = document.createElement('span'); secondary.className = 'library-option-secondary'; secondary.textContent = secondaryText; button.appendChild(secondary); }
        button.addEventListener('pointerdown', event => event.preventDefault());
        button.addEventListener('click', () => selectLibrary(kind, config.key(item)));
        return button;
      });
      if (!children.length) { const empty = document.createElement('div'); empty.className = 'library-empty'; empty.textContent = config.source().length ? 'Совпадений не найдено.' : 'Сохраненных записей пока нет.'; children.push(empty); }
      options.replaceChildren(...children); options.dataset.activeIndex = '-1';
      setLibraryButtons(kind);
      options.hidden = !open; input.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    function renderLibraries() {
      Object.keys(libraryConfigs).forEach(kind => renderLibrary(kind, false));
    }
    function selectLibrary(kind, key) {
      const config = libraryConfigs[kind], item = libraryItem(kind, key);
      if (!item) return;
      selectedLibrary[kind] = key;
      document.getElementById(config.inputId).value = libraryLabel(config, item);
      config.apply(item); closeLibrary(kind); setLibraryButtons(kind);
    }
    function bindLibraries() {
      Object.entries(libraryConfigs).forEach(([kind, config]) => {
        const input = document.getElementById(config.inputId), options = document.getElementById(config.optionsId);
        input.addEventListener('focus', () => renderLibrary(kind, true));
        input.addEventListener('input', () => {
          const selected = libraryItem(kind, selectedLibrary[kind]);
          const selectedLabel = selected ? libraryLabel(config, selected) : '';
          if (input.value !== selectedLabel) selectedLibrary[kind] = null;
          renderLibrary(kind, true);
        });
        input.addEventListener('blur', () => setTimeout(() => closeLibrary(kind), 120));
        input.addEventListener('keydown', event => {
          if (event.key === 'Escape') { closeLibrary(kind); return; }
          if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
          const buttons = [...options.querySelectorAll('.library-option')];
          if (!buttons.length) return;
          event.preventDefault();
          if (event.key === 'Enter') { const active = Number(options.dataset.activeIndex); if (active >= 0) buttons[active].click(); return; }
          if (options.hidden) renderLibrary(kind, true);
          const visibleButtons = [...options.querySelectorAll('.library-option')];
          let next = Number(options.dataset.activeIndex);
          next = event.key === 'ArrowDown' ? Math.min(visibleButtons.length - 1, next + 1) : Math.max(0, next <= 0 ? 0 : next - 1);
          visibleButtons.forEach((button, index) => { button.dataset.active = String(index === next); });
          options.dataset.activeIndex = String(next); input.setAttribute('aria-activedescendant', visibleButtons[next].id); visibleButtons[next].scrollIntoView({ block: 'nearest' });
        });
      });
      document.addEventListener('pointerdown', event => {
        Object.entries(libraryConfigs).forEach(([kind, config]) => { if (!event.target.closest(`#${config.inputId}, #${config.optionsId}`)) closeLibrary(kind); });
      });
    }
    function renderPrivacy() {
      storageToggle.checked = prefs.storageEnabled;
      retentionSelect.value = String(prefs.retentionDays);
      retentionSelect.disabled = !prefs.storageEnabled;
      const retentionText = prefs.retentionDays === 'always' ? 'без ограничения срока' : prefs.retentionDays === 365 ? 'не более 1 года' : prefs.retentionDays === 183 ? 'не более полугода' : 'не более 30 дней';
      privacyText.textContent = !prefs.storageEnabled ? 'Сохранение отключено. Данные существуют только до закрытия этой вкладки и никуда не передаются.' : `Данные хранятся только на этом компьютере ${retentionText} и никуда не передаются.`;
    }
    function toast(message, tone = 'success') {
      const root = document.getElementById('toast');
      document.getElementById('toastMessage').textContent = message;
      document.getElementById('toastAction').hidden = true;
      root.dataset.tone = tone;
      root.hidden = false;
      clearTimeout(toast.timer);
      toast.timer = setTimeout(() => { root.hidden = true; }, 6000);
    }
    function updateField(id, value) {
      fields[id].value = value == null ? '' : String(value);
    }
    function addCustomer(silent = false) {
      const values = { customer: normalize(fields.customer.value), position: normalize(fields.customerPosition.value), name: normalize(fields.customerName.value), basis: normalize(fields.customerBasis.value) };
      if (!values.customer || !values.position || !values.name || !values.basis) { if (!silent) toast('Заполните все сведения о Заказчике и его представителе.', 'warn'); return; }
      const found = state.customerCards.find(card => card.customer.toLocaleLowerCase('ru') === values.customer.toLocaleLowerCase('ru'));
      if (found) {
        selectedLibrary.customer = found.id; document.getElementById('customerCardSelect').value = libraryLabel(libraryConfigs.customer, found); renderLibraries();
        if (!silent) toast('Карточка этого Заказчика уже существует. Для изменений нажмите «Обновить».', 'warn');
        return;
      }
      const card = { id: uid(), ...values, updatedAt: nowIso() };
      state.customerCards.unshift(card);
      state.customerCards = state.customerCards.slice(0, 500);
      selectedLibrary.customer = card.id; document.getElementById('customerCardSelect').value = libraryLabel(libraryConfigs.customer, card);
      persistState(); renderLibraries();
      if (!silent) toast('Карточка заказчика сохранена.');
    }
    function addExecutorSigner(silent = false) {
      const card = { position: normalize(fields.assocPosition.value), name: normalize(fields.assocName.value), basis: normalize(fields.assocBasis.value) };
      if (!card.position || !card.name || !card.basis) { if (!silent) toast('Заполните должность, имя и основание полномочий подписанта Исполнителя.', 'warn'); return; }
      const found = state.executorSignerCards.find(item => item.name.toLocaleLowerCase('ru') === card.name.toLocaleLowerCase('ru'));
      const saved = found || { id: uid(), ...card, updatedAt: nowIso() };
      if (found) Object.assign(found, card, { updatedAt: nowIso() }); else state.executorSignerCards.unshift(saved);
      state.executorSignerCards = state.executorSignerCards.slice(0, 500);
      selectedLibrary.executorSigner = saved.id; document.getElementById('executorSignerCardSelect').value = signerLabel(saved);
      persistState(); renderLibraries();
      if (!silent) toast('Подписант Исполнителя сохранен.');
    }
    function addService(silent = false) {
      const service = normalize(fields.serviceName.value);
      if (!service) { if (!silent) toast('Сначала укажите наименование услуг.', 'warn'); return; }
      state.serviceTemplates = [service, ...state.serviceTemplates.filter(item => item.toLocaleLowerCase('ru') !== service.toLocaleLowerCase('ru'))].slice(0, 500);
      selectedLibrary.service = service; document.getElementById('serviceTemplateSelect').value = service;
      persistState(); renderLibraries();
      if (!silent) toast('Формулировка добавлена в типовые.');
    }
    function updateCustomer() {
      const card = libraryItem('customer', selectedLibrary.customer);
      const values = { customer: normalize(fields.customer.value), position: normalize(fields.customerPosition.value), name: normalize(fields.customerName.value), basis: normalize(fields.customerBasis.value) };
      if (!card) { toast('Сначала выберите сохраненного Заказчика из списка.', 'warn'); return; }
      if (!values.customer || !values.position || !values.name || !values.basis) { toast('Заполните все сведения о Заказчике и его представителе.', 'warn'); return; }
      if (state.customerCards.some(item => item.id !== card.id && item.customer.toLocaleLowerCase('ru') === values.customer.toLocaleLowerCase('ru'))) { toast('Заказчик с таким наименованием уже сохранен.', 'warn'); return; }
      Object.assign(card, values, { updatedAt: nowIso() }); document.getElementById('customerCardSelect').value = libraryLabel(libraryConfigs.customer, card);
      persistState(); renderLibraries(); toast('Карточка заказчика обновлена.');
    }
    function updateSigner(kind) {
      const card = libraryItem(kind, selectedLibrary[kind]);
      if (!card) { toast('Сначала выберите сохраненного подписанта Исполнителя из списка.', 'warn'); return; }
      const values = { position: normalize(fields.assocPosition.value), name: normalize(fields.assocName.value), basis: normalize(fields.assocBasis.value) };
      if (!values.position || !values.name || !values.basis) { toast('Заполните должность, имя и основание полномочий подписанта.', 'warn'); return; }
      const source = state.executorSignerCards;
      if (source.some(item => item.id !== card.id && item.name.toLocaleLowerCase('ru') === values.name.toLocaleLowerCase('ru'))) { toast('Подписант с таким ФИО уже сохранен.', 'warn'); return; }
      Object.assign(card, values, { updatedAt: nowIso() }); document.getElementById(libraryConfigs[kind].inputId).value = signerLabel(card);
      persistState(); renderLibraries(); toast('Карточка подписанта Исполнителя обновлена.');
    }
    function updateService() {
      const oldValue = libraryItem('service', selectedLibrary.service), service = normalize(fields.serviceName.value);
      if (!oldValue) { toast('Сначала выберите сохраненную формулировку из списка.', 'warn'); return; }
      if (!service) { toast('Сначала укажите наименование услуг.', 'warn'); return; }
      if (state.serviceTemplates.some(item => item !== oldValue && item.toLocaleLowerCase('ru') === service.toLocaleLowerCase('ru'))) { toast('Такая формулировка уже сохранена.', 'warn'); return; }
      const index = state.serviceTemplates.indexOf(oldValue); state.serviceTemplates[index] = service; selectedLibrary.service = service; document.getElementById('serviceTemplateSelect').value = service;
      persistState(); renderLibraries(); toast('Типовая формулировка обновлена.');
    }
    function deleteLibrary(kind) {
      const config = libraryConfigs[kind], item = libraryItem(kind, selectedLibrary[kind]);
      if (!item) { toast('Сначала выберите сохраненную запись из списка.', 'warn'); return; }
      const name = config.primary(item);
      if (!confirm(`Удалить сохраненную запись «${name}»?`)) return;
      if (kind === 'customer') state.customerCards = state.customerCards.filter(card => card.id !== item.id);
      else if (kind === 'executorSigner') state.executorSignerCards = state.executorSignerCards.filter(card => card.id !== item.id);
      else state.serviceTemplates = state.serviceTemplates.filter(value => value !== item);
      selectedLibrary[kind] = null; document.getElementById(config.inputId).value = '';
      persistState(); renderLibraries(); toast('Сохраненная запись удалена.', 'warn');
    }
    function updateContractPlaceholder() {
      const examples = { rr: '26.001.01.026РР', rrPoa: '26.001.01.026РР', rrms: '26.001.01.026РР-МС', rrs: '26.001.01.026РРС' };
      fields.contractNumber.placeholder = examples[fields.executor.value] || examples.rr;
    }
    function openNameModal(mode) {
      nameMode = mode;
      const modal = document.getElementById('draftNameModal');
      const input = document.getElementById('draftNameInput');
      document.getElementById('draftNameTitle').textContent = mode === 'new' ? 'Новый черновик' : 'Переименовать черновик';
      input.value = mode === 'rename' ? currentDraft().name : '';
      modal.hidden = false;
      document.querySelector('.app-shell').setAttribute('inert', '');
      setTimeout(() => { input.focus(); input.select(); });
    }
    function closeNameModal() {
      document.getElementById('draftNameModal').hidden = true;
      document.querySelector('.app-shell').removeAttribute('inert');
    }
    function commitName() {
      const name = normalize(document.getElementById('draftNameInput').value).slice(0, 60);
      if (!name) { toast('Укажите название черновика.', 'warn'); return; }
      if (nameMode === 'new') {
        saveCurrent(true);
        const draft = { id: uid(), name, fields: defaultFields(), updatedAt: nowIso() };
        state.drafts.push(draft); state.activeDraftId = draft.id; restore(draft.fields);
      } else currentDraft().name = name;
      persistState(); renderDrafts(); closeNameModal();
      toast(nameMode === 'new' ? 'Новый черновик создан.' : 'Черновик переименован.');
    }
    function deleteDraft() {
      if (state.drafts.length === 1) return;
      const draft = currentDraft();
      if (!confirm(`Удалить черновик «${draft.name}»?`)) return;
      const index = state.drafts.indexOf(draft);
      state.drafts.splice(index, 1);
      const next = state.drafts[Math.max(0, index - 1)];
      state.activeDraftId = next.id; restore(next.fields); persistState(); renderDrafts();
      toast('Черновик удален.', 'warn');
    }
    function switchDraft() {
      const targetId = draftSelect.value;
      saveCurrent(true);
      const draft = state.drafts.find(item => item.id === targetId);
      if (!draft) return;
      state.activeDraftId = draft.id; restore(draft.fields); persistState(); renderDrafts();
      toast(`Открыт черновик «${draft.name}».`);
    }
    function repeatLast() {
      if (!state.lastAct?.fields) { toast('Сначала сформируйте хотя бы один акт.', 'warn'); return; }
      const repeated = { ...state.lastAct.fields, actDate: '', contractDate: '', contractNumber: '' };
      restore(repeated); saveCurrent(true);
      toast('Данные предыдущего акта перенесены. Номер и даты очищены.');
    }
    function openDefaults() {
      document.getElementById('defaultCity').value = prefs.defaults.city || '';
      document.getElementById('defaultServicePlace').value = prefs.defaults.servicePlace || '';
      document.getElementById('defaultDateMode').value = prefs.defaults.dateMode || 'blank';
      document.getElementById('defaultsModal').hidden = false;
      document.querySelector('.app-shell').setAttribute('inert', '');
      setTimeout(() => document.getElementById('defaultCity').focus());
    }
    function closeDefaults() {
      document.getElementById('defaultsModal').hidden = true;
      document.querySelector('.app-shell').removeAttribute('inert');
    }
    function saveDefaults() {
      prefs.defaults = { city: normalize(document.getElementById('defaultCity').value), servicePlace: normalize(document.getElementById('defaultServicePlace').value), dateMode: document.getElementById('defaultDateMode').value };
      persistPrefs(); persistState(); renderPrivacy(); closeDefaults();
      toast(prefs.storageEnabled ? 'Значения по умолчанию сохранены.' : 'Значения будут действовать только в этой вкладке.');
    }
    function toggleStorage() {
      prefs.storageEnabled = storageToggle.checked;
      persistPrefs();
      if (!prefs.storageEnabled) {
        removeStoredData();
        document.getElementById('saveIndicator').dataset.state = 'idle';
        document.getElementById('saveStatusText').textContent = 'Сохранение отключено';
        toast('Сохраненные черновики и карточки удалены с этого компьютера.', 'warn');
      } else {
        persistState();
        fields.executor.dispatchEvent(new Event('input', { bubbles: true }));
        toast('Локальное сохранение включено.');
      }
      renderPrivacy();
    }
    function changeRetention() {
      const value = retentionSelect.value;
      prefs.retentionDays = value === 'always' ? 'always' : [30, 183, 365].includes(Number(value)) ? Number(value) : 30;
      persistPrefs(); persistState(); renderPrivacy();
      toast(`Срок хранения: ${retentionSelect.selectedOptions[0]?.textContent || '30 дней'}.`);
    }
    function semanticErrors() {
      const errors = [];
      const actDate = fields.actDate.value, contractDate = fields.contractDate.value;
      if (actDate && contractDate && actDate < contractDate) errors.push({ key: 'actDate', label: 'Дата акта', message: 'Дата акта не может быть раньше даты договора.' });
      const nameKeys = fields.executor.value === 'rrPoa' ? ['customerName', 'assocName'] : ['customerName'];
      nameKeys.forEach(key => {
        const value = normalize(fields[key].value), letters = (value.match(/[A-Za-zА-Яа-яЕе]/g) || []).length;
        if (value && (letters < 3 || /\d|https?:|@|[^A-Za-zА-Яа-яЕе.\-'\s]/u.test(value))) errors.push({ key, label: key === 'assocName' ? 'Имя представителя Исполнителя' : 'Имя представителя Заказчика', message: 'Проверьте формат имени: используйте ФИО или инициалы и фамилию без цифр.' });
      });
      const basisKeys = fields.executor.value === 'rrPoa' ? ['customerBasis', 'assocBasis'] : ['customerBasis'];
      basisKeys.forEach(key => {
        const value = normalize(fields[key].value), letters = (value.match(/[A-Za-zА-Яа-яЕе]/g) || []).length;
        if (value && (letters < 4 || /https?:|www\.|@/i.test(value))) errors.push({ key, label: key === 'assocBasis' ? 'Основание полномочий Исполнителя' : 'Основание полномочий Заказчика', message: 'Укажите содержательное основание полномочий, например Устав или реквизиты доверенности.' });
      });
      return errors;
    }
    function showSemanticErrors(errors) {
      const base = api.validateForm({ showSummary: true, focus: false });
      const list = document.getElementById('validationList');
      const summary = document.getElementById('validationSummary');
      errors.forEach(error => {
        const field = fields[error.key];
        field.setAttribute('aria-invalid', 'true');
        let node = document.getElementById(`${field.id}Validation`);
        if (!node) {
          node = document.createElement('div'); node.id = `${field.id}Validation`; node.className = 'field-validation'; field.closest('.field').appendChild(node);
          const described = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
          if (!described.includes(node.id)) field.setAttribute('aria-describedby', [...described, node.id].join(' '));
        }
        node.textContent = error.message;
        const item = document.createElement('li'), button = document.createElement('button');
        button.type = 'button'; button.textContent = `${error.label}: ${error.message}`; button.onclick = () => field.focus(); item.appendChild(button); list.appendChild(item);
      });
      summary.hidden = false; summary.focus({ preventScroll: true }); summary.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast(`Исправьте данные: найдено ошибок - ${base.errors.length + errors.length}.`, 'error');
    }
    function refreshSemanticHints() {
      [['customerName', 'Формат: инициалы и фамилия или полное ФИО.'], ['assocName', 'Формат: инициалы и фамилия или полное ФИО.']].forEach(([id, message]) => {
        const field = fields[id]; if (!field) return;
        let hint = document.getElementById(`${id}SemanticHint`);
        if (!hint) { hint = document.createElement('div'); hint.id = `${id}SemanticHint`; hint.className = 'semantic-hint'; field.closest('.field').appendChild(hint); field.setAttribute('aria-describedby', `${field.getAttribute('aria-describedby') || ''} ${hint.id}`.trim()); }
        const value = normalize(field.value);
        hint.textContent = value && !/^([A-Za-zА-ЯЕ][.]\s*){1,2}[A-Za-zА-Яа-яЕе][A-Za-zА-Яа-яЕе' -]+$/u.test(value) && !/^[A-Za-zА-Яа-яЕе][A-Za-zА-Яа-яЕе' -]+(?:\s+[A-Za-zА-Яа-яЕе][A-Za-zА-Яа-яЕе' -]+){1,3}$/u.test(value) ? message : '';
      });
    }
    function parseStoredZip(buffer) {
      const view = new DataView(buffer), bytes = new Uint8Array(buffer), decoder = new TextDecoder(), files = new Map();
      let offset = 0;
      while (offset + 30 <= view.byteLength) {
        const signature = view.getUint32(offset, true);
        if (signature === 0x02014b50 || signature === 0x06054b50) break;
        if (signature !== 0x04034b50) throw new Error('Некорректная структура XLSX.');
        const flags = view.getUint16(offset + 6, true), method = view.getUint16(offset + 8, true), size = view.getUint32(offset + 18, true), nameLength = view.getUint16(offset + 26, true), extraLength = view.getUint16(offset + 28, true);
        if (flags & 8 || method !== 0) throw new Error('Поддерживается импорт только XLSX, созданного этим сервисом.');
        const nameStart = offset + 30, dataStart = nameStart + nameLength + extraLength, dataEnd = dataStart + size;
        if (dataEnd > view.byteLength) throw new Error('Файл XLSX поврежден.');
        files.set(decoder.decode(bytes.slice(nameStart, nameStart + nameLength)), bytes.slice(dataStart, dataEnd));
        offset = dataEnd;
      }
      return files;
    }
    function parseRuDate(value) {
      const months = { января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6, июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12 };
      const match = normalize(value).match(/(\d{1,2})\s+([а-я]+)\s+(\d{4})/i);
      if (!match || !months[match[2].toLocaleLowerCase('ru')]) return '';
      return `${match[3]}-${String(months[match[2].toLocaleLowerCase('ru')]).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    }
    function importFields(buffer) {
      const files = parseStoredZip(buffer), sheetBytes = files.get('xl/worksheets/sheet1.xml');
      if (!sheetBytes) throw new Error('В файле отсутствует лист акта.');
      const doc = new DOMParser().parseFromString(new TextDecoder().decode(sheetBytes), 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('Не удалось прочитать лист акта.');
      const cell = ref => [...doc.getElementsByTagNameNS('*', 'c')].find(node => node.getAttribute('r') === ref)?.textContent || '';
      if (!/^АКТ сдачи-приемки оказанных услуг/i.test(normalize(cell('A1')))) throw new Error('Файл не распознан как акт этого сервиса.');
      const values = emptyFields(), intro = normalize(cell('A11')), header = normalize(cell('A3'));
      values.city = normalize(cell('A8'));
      values.actDate = parseRuDate(cell('I8'));
      values.customer = normalize(cell('A5')).replace(/,$/, '');
      values.serviceName = normalize(cell('A23'));
      values.servicePlace = normalize(cell('C34'));
      values.customerName = normalize(cell('E54')).replace(/^\/+|\/+$/g, '');
      const contract = normalize(cell('A2')).match(/по договору №(.+?) от (\d{1,2}\s+[а-я]+\s+\d{4}) г\./i);
      if (contract) { values.contractNumber = contract[1].trim(); values.contractDate = parseRuDate(contract[2]); }
      const amount = normalize(cell('A43')).match(/^([\d\s]+)\s*\(/);
      if (amount) values.amount = amount[1].trim();
      if (/ООО «РР МС»/.test(header)) values.executor = 'rrms';
      else if (/ООО «РРС»/.test(header)) values.executor = 'rrs';
      else values.executor = /генеральный директор Ассоциации по сертификации/.test(intro) ? 'rr' : 'rrPoa';
      const customerPart = intro.match(/и представитель Заказчика, (.+?), действующ(?:ий|ая) на основании (.+?), с другой стороны/i);
      if (customerPart) {
        values.customerBasis = customerPart[2].trim();
        const party = `${values.customer} ${values.customerName}`.trim(), index = customerPart[1].lastIndexOf(party);
        values.customerPosition = index >= 0 ? customerPart[1].slice(0, index).trim() : '';
      }
      if (values.executor === 'rrPoa') {
        const signer = intro.match(/представитель Исполнителя, (.+?) Ассоциации по сертификации "Русский Регистр" (.+?), действующ(?:ий|ая) на основании (.+?), с одной стороны/i);
        if (signer) { values.assocPosition = signer[1].trim(); values.assocName = signer[2].trim(); values.assocBasis = signer[3].trim(); }
      }
      return values;
    }
    async function importXlsx(file) {
      if (!file) return;
      if (file.size > 25 * 1024 * 1024) { toast('Файл слишком большой для импорта.', 'error'); return; }
      try {
        const values = importFields(await file.arrayBuffer());
        restore(values); saveCurrent(true);
        toast(`Данные импортированы из «${file.name}». Проверьте их перед выгрузкой.`);
      } catch (error) {
        console.error(error); toast(error.message || 'Не удалось импортировать XLSX.', 'error');
      } finally { document.getElementById('xlsxFileInput').value = ''; }
    }
    function backupPayload() {
      saveCurrent(true);
      return {
        format: 'acts-constructor-backup',
        formatVersion: 1,
        appVersion: api.APP_VERSION,
        createdAt: nowIso(),
        preferences: { defaults: { ...prefs.defaults }, retentionDays: prefs.retentionDays },
        data: {
          activeDraftId: state.activeDraftId,
          drafts: state.drafts,
          customerCards: state.customerCards,
          executorSignerCards: state.executorSignerCards,
          serviceTemplates: state.serviceTemplates,
          lastAct: state.lastAct
        }
      };
    }
    function downloadBackup() {
      const payload = JSON.stringify(backupPayload(), null, 2), blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `Конструктор_актов_резервная_копия_${todayLocal()}.json`; link.rel = 'noopener';
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Резервная копия черновиков и справочников скачана.');
    }
    function sanitizedFields(source) {
      const result = emptyFields();
      if (!source || typeof source !== 'object') return result;
      fieldIds.forEach(id => { if (id in source) result[id] = String(source[id] ?? '').slice(0, 5000); });
      if (!['rr', 'rrPoa', 'rrms', 'rrs'].includes(result.executor)) result.executor = 'rr';
      return result;
    }
    function sanitizedSignerCards(source) {
      if (!Array.isArray(source)) return [];
      return source.slice(0, 500).map(item => ({ id: uid(), name: normalize(item?.name).slice(0, 120), position: normalize(item?.position).slice(0, 180), basis: normalize(item?.basis).slice(0, 220), updatedAt: nowIso() })).filter(item => item.name && item.position && item.basis);
    }
    function sanitizedCustomerCards(source, drafts = [], legacySigners = []) {
      if (!Array.isArray(source)) return [];
      const normalizedSigners = sanitizedSignerCards(legacySigners);
      return source.slice(0, 500).map(item => {
        const customer = normalize(item?.customer).slice(0, 180);
        const matchingDraft = [...drafts].reverse().find(draft => normalize(draft?.fields?.customer).toLocaleLowerCase('ru') === customer.toLocaleLowerCase('ru') && normalize(draft?.fields?.customerName));
        const legacySigner = matchingDraft ? null : source.length === 1 && normalizedSigners.length === 1 ? normalizedSigners[0] : null;
        return {
          id: item?.id || uid(), customer,
          position: normalize(item?.position || matchingDraft?.fields?.customerPosition || legacySigner?.position).slice(0, 180),
          name: normalize(item?.name || matchingDraft?.fields?.customerName || legacySigner?.name).slice(0, 120),
          basis: normalize(item?.basis || matchingDraft?.fields?.customerBasis || legacySigner?.basis).slice(0, 220),
          updatedAt: item?.updatedAt || nowIso()
        };
      }).filter(item => item.customer);
    }
    function parseBackup(text) {
      let parsed;
      try { parsed = JSON.parse(text); } catch (_) { throw new Error('Файл резервной копии содержит некорректный JSON.'); }
      if (parsed?.format !== 'acts-constructor-backup' || parsed?.formatVersion !== 1 || !parsed.data) throw new Error('Файл не распознан как резервная копия Конструктора актов.');
      const sourceDrafts = Array.isArray(parsed.data.drafts) ? parsed.data.drafts.slice(0, 100) : [];
      if (!sourceDrafts.length) throw new Error('В резервной копии отсутствуют черновики.');
      const drafts = sourceDrafts.map((draft, index) => ({ id: `restored-${index}-${Date.now().toString(36)}`, name: normalize(draft?.name).slice(0, 60) || `Черновик ${index + 1}`, fields: sanitizedFields(draft?.fields), updatedAt: nowIso() }));
      const activeIndex = sourceDrafts.findIndex(draft => draft?.id === parsed.data.activeDraftId);
      const defaults = parsed.preferences?.defaults || {};
      const retentionRaw = parsed.preferences?.retentionDays;
      const retention = String(retentionRaw) === 'always' ? 'always' : Number(retentionRaw);
      return {
        prefs: { defaults: { city: normalize(defaults.city).slice(0, 100), servicePlace: normalize(defaults.servicePlace).slice(0, 180), dateMode: defaults.dateMode === 'today' ? 'today' : 'blank' }, retentionDays: retention === 'always' || [30, 183, 365].includes(retention) ? retention : prefs.retentionDays },
        state: {
          version: 3, updatedAt: nowIso(), activeDraftId: drafts[Math.max(0, activeIndex)]?.id || drafts[0].id, drafts,
          customerCards: sanitizedCustomerCards(parsed.data.customerCards, drafts, parsed.data.signerCards),
          executorSignerCards: sanitizedSignerCards(parsed.data.executorSignerCards),
          serviceTemplates: (Array.isArray(parsed.data.serviceTemplates) ? parsed.data.serviceTemplates : []).slice(0, 500).map(item => normalize(item).slice(0, 1200)).filter(Boolean),
          lastAct: parsed.data.lastAct?.fields ? { fields: sanitizedFields(parsed.data.lastAct.fields), exportedAt: nowIso() } : null
        }
      };
    }
    async function restoreBackup(file) {
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { toast('Файл резервной копии слишком большой.', 'error'); return; }
      try {
        const restored = parseBackup(await file.text());
        if (!confirm('Восстановление заменит текущие черновики и сохраненные справочники. Продолжить?')) return;
        prefs.defaults = restored.prefs.defaults; prefs.retentionDays = restored.prefs.retentionDays; state = restored.state;
        persistPrefs(); persistState(); renderDrafts(); renderLibraries(); renderPrivacy(); restore(currentDraft().fields); updateContractPlaceholder();
        toast(prefs.storageEnabled ? 'Черновики, подписанты, услуги и настройки восстановлены.' : 'Данные восстановлены в этой вкладке. Включите сохранение, чтобы оставить их на компьютере.');
      } catch (error) {
        console.error(error); toast(error.message || 'Не удалось восстановить резервную копию.', 'error');
      } finally { document.getElementById('backupFileInput').value = ''; }
    }

    renderDrafts(); renderLibraries(); bindLibraries(); bindExecutorPicker(); renderPrivacy(); updateContractPlaceholder();
    const selected = currentDraft();
    if (selected?.fields && JSON.stringify(selected.fields) !== JSON.stringify(api.snapshot())) restore(selected.fields);
    persistPrefs(); persistState();

    form.addEventListener('input', () => saveCurrent());
    form.addEventListener('change', () => saveCurrent());
    fields.customerName.addEventListener('blur', refreshSemanticHints);
    fields.assocName.addEventListener('blur', refreshSemanticHints);
    draftSelect.addEventListener('change', switchDraft);
    document.getElementById('newDraftBtn').onclick = () => openNameModal('new');
    document.getElementById('renameDraftBtn').onclick = () => openNameModal('rename');
    document.getElementById('deleteDraftBtn').onclick = deleteDraft;
    document.getElementById('repeatActBtn').onclick = repeatLast;
    document.getElementById('saveCustomerBtn').onclick = () => addCustomer();
    document.getElementById('saveExecutorSignerBtn').onclick = () => addExecutorSigner();
    document.getElementById('updateCustomerBtn').onclick = updateCustomer;
    document.getElementById('deleteCustomerBtn').onclick = () => deleteLibrary('customer');
    document.getElementById('updateExecutorSignerBtn').onclick = () => updateSigner('executorSigner');
    document.getElementById('deleteExecutorSignerBtn').onclick = () => deleteLibrary('executorSigner');
    document.getElementById('saveServiceBtn').onclick = () => addService();
    document.getElementById('updateServiceBtn').onclick = updateService;
    document.getElementById('deleteServiceBtn').onclick = () => deleteLibrary('service');
    storageToggle.onchange = toggleStorage;
    retentionSelect.onchange = changeRetention;
    document.getElementById('defaultsBtn').onclick = openDefaults;
    document.getElementById('cancelDefaultsBtn').onclick = closeDefaults;
    document.querySelector('[data-close-defaults]').onclick = closeDefaults;
    document.getElementById('saveDefaultsBtn').onclick = saveDefaults;
    document.getElementById('cancelDraftNameBtn').onclick = closeNameModal;
    document.querySelector('[data-close-draft-name]').onclick = closeNameModal;
    document.getElementById('saveDraftNameBtn').onclick = commitName;
    document.getElementById('draftNameInput').addEventListener('keydown', event => { if (event.key === 'Enter') commitName(); });
    document.getElementById('importXlsxBtn').onclick = () => document.getElementById('xlsxFileInput').click();
    document.getElementById('xlsxFileInput').onchange = event => importXlsx(event.target.files?.[0]);
    document.getElementById('exportBackupBtn').onclick = downloadBackup;
    document.getElementById('importBackupBtn').onclick = () => document.getElementById('backupFileInput').click();
    document.getElementById('backupFileInput').onchange = event => restoreBackup(event.target.files?.[0]);
    fields.executor.addEventListener('change', updateContractPlaceholder);
    window.addEventListener('appinstalled', () => {
      try { localStorage.setItem(INSTALLED_KEY, '1'); } catch (_) {}
      window.__ACTS_INSTALLED__ = true; renderPrivacy();
      toast('Приложение установлено. Настройка срока хранения сохранена.');
    });
    window.addEventListener('acts:cleared', () => { const values = defaultFields(); restore(values); saveCurrent(true); });
    window.addEventListener('acts:restored', () => saveCurrent(true));
    window.addEventListener('acts:exported', event => {
      state.lastAct = { fields: event.detail.fields, exportedAt: nowIso() };
      addCustomer(true); if (event.detail.fields.executor === 'rrPoa') addExecutorSigner(true); saveCurrent(true); renderLibraries();
    });
    document.addEventListener('keydown', event => {
      const nameModal = document.getElementById('draftNameModal'), defaultsModal = document.getElementById('defaultsModal');
      const openModal = !nameModal.hidden ? nameModal : !defaultsModal.hidden ? defaultsModal : null;
      if (!openModal) return;
      if (event.key === 'Escape') { if (openModal === nameModal) closeNameModal(); else closeDefaults(); return; }
      if (event.key !== 'Tab') return;
      const items = [...openModal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(item => !item.hidden);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    window.__ACTS_WORKSPACE_TEST_API__ = Object.freeze({ semanticErrors, showSemanticErrors, importFields, parseRuDate, parseBackup, backupPayload, updateContractPlaceholder, selectLibrary, getState: () => structuredClone(state), getPreferences: () => structuredClone(prefs) });
  }
})();
