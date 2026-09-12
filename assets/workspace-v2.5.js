'use strict';
(() => {
  const PREFS_KEY = 'actsWorkspacePreferencesV1';
  const DATA_KEY = 'actsWorkspaceDataV1';
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
  prefs.retentionDays = [7, 30, 90, 365].includes(Number(prefs.retentionDays)) ? Number(prefs.retentionDays) : 30;
  prefs.defaults = prefs.defaults && typeof prefs.defaults === 'object' ? prefs.defaults : { city: '', servicePlace: '', dateMode: 'blank' };
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
    const retentionLabel = document.getElementById('retentionLabel');
    const privacyText = document.getElementById('privacyText');
    let saveTimer = 0;
    let nameMode = 'new';
    let state = loadState(api.snapshot());

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
      refreshSemanticHints();
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
      const fresh = stored && Date.parse(stored.updatedAt || '') && Date.now() - Date.parse(stored.updatedAt) <= prefs.retentionDays * DAY;
      if (fresh && Array.isArray(stored.drafts) && stored.drafts.length) {
        stored.customerCards = Array.isArray(stored.customerCards) ? stored.customerCards : [];
        stored.signerCards = Array.isArray(stored.signerCards) ? stored.signerCards : [];
        stored.serviceTemplates = Array.isArray(stored.serviceTemplates) ? stored.serviceTemplates : [];
        stored.recentServices = Array.isArray(stored.recentServices) ? stored.recentServices : [];
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
      return { version: 1, updatedAt: nowIso(), activeDraftId: 'main', drafts: [{ id: 'main', name: 'Основной черновик', fields: migrated, updatedAt: nowIso() }], customerCards: [], signerCards: [], serviceTemplates: [], recentServices: [], lastAct: null };
    }
    function setOptions(select, items, placeholder) {
      const previous = select.value;
      select.replaceChildren(new Option(placeholder, ''), ...items.map(item => new Option(item.label, item.value)));
      if ([...select.options].some(option => option.value === previous)) select.value = previous;
    }
    function renderDrafts() {
      draftSelect.replaceChildren(...state.drafts.map(draft => new Option(draft.name, draft.id)));
      draftSelect.value = state.activeDraftId;
      const draft = currentDraft();
      document.getElementById('activeDraftLabel').textContent = draft?.name || 'Основной черновик';
      document.getElementById('deleteDraftBtn').disabled = state.drafts.length === 1;
    }
    function renderLibraries() {
      setOptions(document.getElementById('customerCardSelect'), state.customerCards.map(card => ({ label: card.customer, value: card.id })), 'Выберите сохраненную карточку');
      setOptions(document.getElementById('signerCardSelect'), state.signerCards.map(card => ({ label: `${card.name} - ${card.position}`, value: card.id })), 'Выберите сохраненного подписанта');
      const select = document.getElementById('serviceTemplateSelect');
      const prior = select.value;
      select.replaceChildren(new Option('Выберите формулировку', ''));
      if (state.serviceTemplates.length) {
        const group = document.createElement('optgroup'); group.label = 'Типовые';
        state.serviceTemplates.forEach((text, index) => group.appendChild(new Option(text, `template:${index}`)));
        select.appendChild(group);
      }
      if (state.recentServices.length) {
        const group = document.createElement('optgroup'); group.label = 'Недавние';
        state.recentServices.forEach((text, index) => group.appendChild(new Option(text, `recent:${index}`)));
        select.appendChild(group);
      }
      if ([...select.options].some(option => option.value === prior)) select.value = prior;
      document.getElementById('removeServiceBtn').disabled = !state.serviceTemplates.length;
    }
    function renderPrivacy() {
      storageToggle.checked = prefs.storageEnabled;
      retentionLabel.textContent = `Срок хранения: ${prefs.retentionDays === 365 ? '1 год' : `${prefs.retentionDays} дней`}`;
      privacyText.textContent = prefs.storageEnabled ? `Данные хранятся только в этом браузере не более ${prefs.retentionDays === 365 ? '1 года' : `${prefs.retentionDays} дней`} и никуда не передаются.` : 'Сохранение отключено. Данные существуют только до закрытия этой вкладки и никуда не передаются.';
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
      const customer = normalize(fields.customer.value);
      if (!customer) { if (!silent) toast('Сначала укажите наименование Заказчика.', 'warn'); return; }
      const found = state.customerCards.find(card => card.customer.toLocaleLowerCase('ru') === customer.toLocaleLowerCase('ru'));
      if (found) found.updatedAt = nowIso(); else state.customerCards.unshift({ id: uid(), customer, updatedAt: nowIso() });
      state.customerCards = state.customerCards.slice(0, 40);
      persistState(); renderLibraries();
      if (!silent) toast('Карточка заказчика сохранена.');
    }
    function addSigner(silent = false) {
      const card = { position: normalize(fields.customerPosition.value), name: normalize(fields.customerName.value), basis: normalize(fields.customerBasis.value) };
      if (!card.position || !card.name || !card.basis) { if (!silent) toast('Заполните должность, имя и основание полномочий подписанта.', 'warn'); return; }
      const found = state.signerCards.find(item => item.name.toLocaleLowerCase('ru') === card.name.toLocaleLowerCase('ru') && item.position.toLocaleLowerCase('ru') === card.position.toLocaleLowerCase('ru'));
      if (found) Object.assign(found, card, { updatedAt: nowIso() }); else state.signerCards.unshift({ id: uid(), ...card, updatedAt: nowIso() });
      state.signerCards = state.signerCards.slice(0, 40);
      persistState(); renderLibraries();
      if (!silent) toast('Карточка подписанта сохранена.');
    }
    function addService(silent = false) {
      const service = normalize(fields.serviceName.value);
      if (!service) { if (!silent) toast('Сначала укажите наименование услуг.', 'warn'); return; }
      state.serviceTemplates = [service, ...state.serviceTemplates.filter(item => item !== service)].slice(0, 30);
      persistState(); renderLibraries();
      if (!silent) toast('Формулировка добавлена в типовые.');
    }
    function useServiceSelection() {
      const value = document.getElementById('serviceTemplateSelect').value;
      if (!value) return;
      const [kind, rawIndex] = value.split(':');
      const source = kind === 'template' ? state.serviceTemplates : state.recentServices;
      updateField('serviceName', source[Number(rawIndex)] || '');
      fields.serviceName.dispatchEvent(new Event('input', { bubbles: true }));
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
      document.getElementById('retentionDays').value = String(prefs.retentionDays);
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
      prefs.retentionDays = Number(document.getElementById('retentionDays').value) || 30;
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

    renderDrafts(); renderLibraries(); renderPrivacy();
    const selected = currentDraft();
    if (selected?.fields && JSON.stringify(selected.fields) !== JSON.stringify(api.snapshot())) restore(selected.fields);
    persistPrefs(); persistState();

    form.addEventListener('input', () => saveCurrent());
    form.addEventListener('change', () => saveCurrent());
    form.addEventListener('click', event => {
      if (event.target.closest('#downloadXlsxBtn')) {
        const errors = semanticErrors();
        if (errors.length) { event.preventDefault(); event.stopPropagation(); showSemanticErrors(errors); }
      }
    }, true);
    fields.customerName.addEventListener('blur', refreshSemanticHints);
    fields.assocName.addEventListener('blur', refreshSemanticHints);
    draftSelect.addEventListener('change', switchDraft);
    document.getElementById('newDraftBtn').onclick = () => openNameModal('new');
    document.getElementById('renameDraftBtn').onclick = () => openNameModal('rename');
    document.getElementById('deleteDraftBtn').onclick = deleteDraft;
    document.getElementById('repeatActBtn').onclick = repeatLast;
    document.getElementById('saveCustomerBtn').onclick = () => addCustomer();
    document.getElementById('saveSignerBtn').onclick = () => addSigner();
    document.getElementById('customerCardSelect').onchange = event => { const card = state.customerCards.find(item => item.id === event.target.value); if (card) { updateField('customer', card.customer); fields.customer.dispatchEvent(new Event('input', { bubbles: true })); } };
    document.getElementById('signerCardSelect').onchange = event => { const card = state.signerCards.find(item => item.id === event.target.value); if (card) { updateField('customerPosition', card.position); updateField('customerName', card.name); updateField('customerBasis', card.basis); fields.customerName.dispatchEvent(new Event('input', { bubbles: true })); } };
    document.getElementById('serviceTemplateSelect').onchange = useServiceSelection;
    document.getElementById('saveServiceBtn').onclick = () => addService();
    document.getElementById('removeServiceBtn').onclick = () => { const service = normalize(fields.serviceName.value); const before = state.serviceTemplates.length; state.serviceTemplates = state.serviceTemplates.filter(item => item !== service); if (state.serviceTemplates.length === before) { toast('Эта формулировка не входит в типовые.', 'warn'); return; } persistState(); renderLibraries(); toast('Формулировка удалена из типовых.', 'warn'); };
    storageToggle.onchange = toggleStorage;
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
    window.addEventListener('acts:cleared', () => { const values = defaultFields(); restore(values); saveCurrent(true); });
    window.addEventListener('acts:restored', () => saveCurrent(true));
    window.addEventListener('acts:exported', event => {
      state.lastAct = { fields: event.detail.fields, exportedAt: nowIso() };
      const service = normalize(event.detail.fields.serviceName);
      if (service) state.recentServices = [service, ...state.recentServices.filter(item => item !== service)].slice(0, 8);
      addCustomer(true); addSigner(true); saveCurrent(true); renderLibraries();
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
    window.__ACTS_WORKSPACE_TEST_API__ = Object.freeze({ semanticErrors, importFields, parseRuDate, getState: () => structuredClone(state), getPreferences: () => structuredClone(prefs) });
  }
})();
