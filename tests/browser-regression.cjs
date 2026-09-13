'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.QA_PORT || 4173);
const baseUrl = `http://127.0.0.1:${port}/`;
const outputDir = process.env.QA_OUTPUT || path.join(os.tmpdir(), 'acts-v3.0-qa');
fs.mkdirSync(outputDir, { recursive: true });

const validData = {
  actDate: '2026-09-12', city: 'Санкт-Петербург', customer: 'ООО «Тестовый заказчик»',
  contractNumber: '26.001.01.026РР', contractDate: '2026-09-01', customerPosition: 'генеральный директор',
  customerName: 'И.И. Иванов', customerBasis: 'Устава', servicePlace: 'Санкт-Петербург, Россия',
  amount: '45 000,00', serviceName: 'Услуги по оценке соответствия и сертификации'
};

function startServer() {
  const python = process.env.PYTHON || 'python3';
  const child = spawn(python, ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' });
  return child;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { const response = await fetch(baseUrl); if (response.ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Local server did not start.');
}

async function fill(page, data = validData) {
  for (const [id, value] of Object.entries(data)) await page.locator(`#${id}`).fill(value);
}

(async () => {
  const server = startServer();
  let browser;
  try {
    await waitForServer();
    const launch = { headless: true };
    if (process.env.QA_BROWSER_PATH) launch.executablePath = process.env.QA_BROWSER_PATH;
    browser = await chromium.launch(launch);
    const context = await browser.newContext({ acceptDownloads: true });
    await context.addInitScript(() => {
      if (sessionStorage.getItem('actsQaInitialized')) return;
      localStorage.clear();
      sessionStorage.setItem('actsQaInitialized', '1');
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()); });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });

    assert.equal(await page.evaluate(() => window.__ACTS_TEST_API__?.APP_VERSION), '3.0');
    assert.equal((await page.locator('#importXlsxBtn').textContent()).trim(), 'Загрузить данные из акта');
    assert.equal(await page.locator('#importXlsxBtn img[src="assets/pictogram-excel-v2.9.svg"]').count(), 1);
    assert.equal((await page.locator('#downloadXlsxBtn .button-label').textContent()).trim(), 'Скачать акт');
    assert.equal(await page.locator('#downloadXlsxBtn img[src="assets/pictogram-excel-v2.9.svg"]').count(), 1);
    assert.equal(await page.locator('#retentionDays').inputValue(), 'always');
    assert.equal((await page.evaluate(() => window.__ACTS_WORKSPACE_TEST_API__.getPreferences())).retentionDays, 'always');
    assert.match(await page.locator('#privacyText').innerText(), /без ограничения срока/);
    const selectTypography = await page.evaluate(() => {
      const values = ['executorPickerLabel', 'draftPickerLabel', 'retentionPickerLabel'].map(id => {
        const style = getComputedStyle(document.getElementById(id));
        return { id, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, color: style.color };
      });
      return Object.fromEntries(values.map(({ id, ...style }) => [id, style]));
    });
    assert.deepEqual(selectTypography.draftPickerLabel, selectTypography.executorPickerLabel, 'draft selector typography must match executor value');
    assert.deepEqual(selectTypography.retentionPickerLabel, selectTypography.executorPickerLabel, 'retention selector typography must match executor value');
    const listTypography = await page.evaluate(() => {
      const ids = ['executorPickerOptions', 'draftPickerOptions', 'retentionPickerOptions'];
      return Object.fromEntries(ids.map(id => {
        const style = getComputedStyle(document.querySelector(`#${id} .library-option[aria-selected="true"] strong`));
        return [id, { fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, color: style.color }];
      }));
    });
    assert.deepEqual(listTypography.draftPickerOptions, listTypography.executorPickerOptions, 'draft list typography must match executor list');
    assert.deepEqual(listTypography.retentionPickerOptions, listTypography.executorPickerOptions, 'retention list typography must match executor list');
    const iconSystem = await page.evaluate(() => ({ pictograms: document.querySelectorAll('body img.ui-pictogram').length, previewTools: document.querySelectorAll('body img.preview-tool-icon').length, utilities: document.querySelectorAll('body img.ui-icon').length, legacySvgIcons: document.querySelectorAll('body svg.ui-icon').length, inconsistent: document.querySelectorAll('body svg:not(.ui-icon)').length, inlinePaths: document.querySelectorAll('body svg path, body svg circle, body svg rect').length, externalUses: document.querySelectorAll('body svg use[href^="assets/icons-v2.9.svg#"]').length }));
    assert.equal(iconSystem.pictograms, 8, 'main product symbols must use object-based illustrated pictograms');
    assert.equal(iconSystem.previewTools, 6, 'preview controls must use reliable standalone image files');
    assert.ok(iconSystem.utilities >= 10, 'utility controls must keep the unified standalone image system');
    assert.equal(iconSystem.legacySvgIcons, 0); assert.equal(iconSystem.inconsistent, 0); assert.equal(iconSystem.inlinePaths, 0); assert.equal(iconSystem.externalUses, 0);
    assert.equal(await page.locator('.footer-heart img').evaluate(image => image.complete && image.naturalWidth > 0), true, 'footer heart must be a loaded standalone image');
    assert.equal(await page.locator('label[for="amount"]').innerText(), 'Стоимость с НДС');
    assert.equal(await page.locator('#formTitle + p').innerText(), 'Заполните реквизиты, остальное сервис сделает сам.');
    assert.equal(await page.locator('#zoomOutBtn img').evaluate(image => image.complete && image.naturalWidth > 0), true);
    assert.equal(await page.locator('#zoomInBtn img').evaluate(image => image.complete && image.naturalWidth > 0), true);
    assert.equal(await page.locator('#openPreviewBtn img').evaluate(image => image.complete && image.naturalWidth > 0), true);
    await page.locator('#workTools').evaluate(element => { element.open = true; });
    const settingsTypography = await page.evaluate(() => ({
      settingsHeading: getComputedStyle(document.querySelector('.work-tools-summary strong')).fontSize,
      sectionHeading: getComputedStyle(document.querySelector('.section-heading strong')).fontSize,
      settingsLabel: getComputedStyle(document.querySelector('.retention-picker > label')).fontSize,
      fieldLabel: getComputedStyle(document.querySelector('.form-section label')).fontSize
    }));
    assert.equal(settingsTypography.settingsHeading, settingsTypography.sectionHeading, 'settings heading must match section headings');
    assert.equal(settingsTypography.settingsLabel, settingsTypography.fieldLabel, 'settings labels must match field labels');
    await page.screenshot({ path: path.join(outputDir, 'settings-typography.png'), fullPage: false });
    assert.equal(await page.locator('#draftSelect').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('#retentionDays').getAttribute('aria-hidden'), 'true');
    await page.locator('#draftPickerButton').click();
    assert.equal(await page.locator('#draftPickerOptions').isVisible(), true);
    assert.deepEqual(await page.locator('#draftPickerOptions .library-option').allInnerTexts(), ['Основной черновик']);
    assert.equal(await page.locator('#draftPickerOptions .library-option[aria-selected="true"]').getAttribute('data-value'), 'main');
    await page.screenshot({ path: path.join(outputDir, 'settings-draft-picker.png'), fullPage: false });
    await page.locator('#draftPickerButton').click();
    await page.locator('#retentionPickerButton').click();
    assert.equal(await page.locator('#retentionPickerOptions').isVisible(), true);
    assert.deepEqual(await page.locator('#retentionPickerOptions .library-option').allInnerTexts(), ['30 дней', 'Полгода', '1 год', 'Навсегда']);
    assert.equal(await page.locator('#retentionPickerOptions .library-option[aria-selected="true"]').getAttribute('data-value'), 'always');
    await page.screenshot({ path: path.join(outputDir, 'settings-retention-picker.png'), fullPage: false });
    await page.locator('#retentionPickerOptions .library-option[data-value="183"]').click();
    assert.equal(await page.locator('#retentionDays').inputValue(), '183');
    assert.equal((await page.evaluate(() => window.__ACTS_WORKSPACE_TEST_API__.getPreferences())).retentionDays, 183, 'custom retention list must update the real preference');
    await page.locator('#retentionDays').selectOption('always');
    assert.equal(await page.locator('#retentionPickerLabel').innerText(), 'Навсегда');
    for (const [executor, placeholder] of Object.entries({ rr: '26.001.01.026РР', rrPoa: '26.001.01.026РР', rrms: '26.001.01.026РР-МС', rrs: '26.001.01.026РРС' })) {
      await page.locator('#executor').selectOption(executor);
      assert.equal(await page.locator('#contractNumber').getAttribute('placeholder'), placeholder);
      assert.equal(await page.locator('#executorPickerLabel').innerText(), await page.locator(`#executor option[value="${executor}"]`).innerText());
    }
    await page.locator('#executor').selectOption('rr');
    await page.locator('#poaFields').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#poaFields').isVisible(), false, 'executor signer library must be hidden for the regular Association executor');
    await page.locator('#executor').selectOption('rrPoa');
    await page.locator('#poaFields').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#poaFields').isVisible(), true, 'executor signer library must be shown for the power-of-attorney executor');
    assert.equal(await page.locator('.poa-heading strong').innerText(), 'Сведения о представителе');
    assert.equal(await page.locator('.poa-heading small').count(), 0);
    assert.equal(await page.locator('.poa-heading img.ui-pictogram').count(), 1, 'power-of-attorney heading must retain its illustrated pictogram');
    assert.equal(await page.locator('#assocPosition').getAttribute('placeholder'), 'директор по сертификации');
    assert.equal(await page.locator('#executorSignerCardSelect').getAttribute('placeholder'), 'Начните вводить имя');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('#assocName').compareDocumentPosition(document.querySelector('#assocPosition')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'executor representative name must precede position');
    const signerRow = await page.evaluate(() => { const field = document.getElementById('executorSignerCardSelect').getBoundingClientRect(), actions = document.getElementById('saveExecutorSignerBtn').closest('.library-actions').getBoundingClientRect(); return { fieldTop: field.top, fieldBottom: field.bottom, actionsTop: actions.top, actionsBottom: actions.bottom }; });
    assert.ok(Math.max(signerRow.fieldTop, signerRow.actionsTop) < Math.min(signerRow.fieldBottom, signerRow.actionsBottom), 'executor signer actions must be on the same row as the picker');
    await page.locator('#executor').selectOption('rr');
    await page.locator('#poaFields').waitFor({ state: 'hidden' });
    await page.locator('#executorPickerButton').click();
    assert.equal(await page.locator('#executorPickerOptions .library-option').count(), 4);
    assert.equal(await page.locator('#executorPickerOptions .library-option[aria-selected="true"]').getAttribute('data-value'), 'rr');
    await page.locator('#executorPickerOptions .library-option[data-value="rrs"]').click();
    assert.equal(await page.locator('#executor').inputValue(), 'rrs');
    assert.equal(await page.locator('#executorPickerButton').innerText(), 'ООО «РРС»');
    assert.equal(await page.locator('#executorPickerOptions').innerText().then(text => text.includes('НДС')), false);
    await page.locator('#executor').selectOption('rr');
    assert.equal(await page.getByText('Ставка определяется выбранным исполнителем').count(), 0);
    assert.equal(await page.locator('.section-heading').count(), 3);
    assert.deepEqual(await page.locator('.section-heading strong').allInnerTexts(), ['Исполнитель', 'Заказчик', 'Договор']);
    assert.equal(await page.locator('.section-heading small').count(), 0, 'section headings must not have explanatory subtitles');
    assert.equal(await page.locator('#customer').evaluate(element => element.closest('.form-section')?.querySelector('.section-heading strong')?.textContent), 'Заказчик');
    assert.equal(await page.locator('#contractNumber').evaluate(element => element.closest('.form-section')?.querySelector('.section-heading strong')?.textContent), 'Договор');
    assert.equal(await page.locator('#amount').evaluate(element => element.closest('.form-section')?.querySelector('.section-heading strong')?.textContent), 'Договор');
    assert.equal(await page.locator('#actDate').evaluate(element => element.closest('.form-section')?.querySelector('.section-heading strong')?.textContent), 'Договор');
    assert.equal(await page.locator('#city').evaluate(element => element.closest('.form-section')?.querySelector('.section-heading strong')?.textContent), 'Договор');
    assert.equal(await page.locator('label[for="contractDate"]').innerText(), 'Дата договора');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('#serviceName').compareDocumentPosition(document.querySelector('#amount')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'cost must follow the supplied services');
    const contractOrder = await page.evaluate(() => ['contractNumber', 'contractDate', 'city', 'serviceTemplateSelect', 'serviceName', 'amount', 'actDate', 'servicePlace'].map(id => document.getElementById(id)).every((element, index, elements) => index === 0 || Boolean(elements[index - 1].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)));
    assert.equal(contractOrder, true, 'contract block fields must follow the approved order');
    assert.deepEqual(await page.locator('#saveCustomerBtn, #saveExecutorSignerBtn, #saveServiceBtn').allInnerTexts(), ['Создать', 'Создать', 'Создать']);
    assert.equal(await page.locator('#signerCardSelect, #signerCardOptions, #saveSignerBtn, #updateSignerBtn, #deleteSignerBtn').count(), 0, 'customer signer must not exist as a separate library');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('#executorPickerButton').compareDocumentPosition(document.querySelector('#executorSignerCardSelect')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'executor signer library must follow executor selection');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('#executorSignerCardSelect').compareDocumentPosition(document.querySelector('#actDate')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'executor signer library must precede act details');
    assert.equal(await page.locator('#city').getAttribute('placeholder'), 'г. Санкт-Петербург');
    assert.equal(await page.locator('#servicePlace').getAttribute('placeholder'), 'г. Санкт-Петербург, Россия');
    assert.equal(await page.locator('#defaultCity').getAttribute('placeholder'), 'г. Санкт-Петербург');
    assert.equal(await page.locator('#defaultServicePlace').getAttribute('placeholder'), 'г. Санкт-Петербург, Россия');
    assert.equal(await page.locator('.work-tools-summary strong').innerText(), 'Настройки сервиса');
    assert.equal(await page.locator('.work-tools-summary em').count(), 0);
    assert.equal(await page.locator('label[for="draftSelect"]').count(), 0);
    assert.equal(await page.locator('#mobilePreviewQuickBtn').count(), 0);
    assert.equal(await page.locator('#amountWordsShown, #vatShown, #vatAmountShown, .vat-card').count(), 0, 'duplicate cost and VAT breakdown must not be shown in the form');
    const finalFieldRow = await page.evaluate(() => ['amount', 'actDate', 'servicePlace'].map(id => ({ id, top: document.getElementById(id).getBoundingClientRect().top })));
    assert.deepEqual(finalFieldRow.map(item => item.id), ['amount', 'actDate', 'servicePlace']);
    assert.ok(Math.max(...finalFieldRow.map(item => item.top)) - Math.min(...finalFieldRow.map(item => item.top)) <= 1, 'cost, act date and service place must share one desktop row');
    const settingsSelectMetrics = await page.evaluate(() => {
      const executorFontSize = parseFloat(getComputedStyle(document.getElementById('executorPickerLabel')).fontSize);
      return [['draftPickerButton', 'draftPickerLabel'], ['retentionPickerButton', 'retentionPickerLabel']].map(([buttonId, labelId]) => {
        const element = document.getElementById(buttonId);
        return { height: element.getBoundingClientRect().height, fontSize: parseFloat(getComputedStyle(document.getElementById(labelId)).fontSize), executorFontSize };
      });
    });
    const executorHeight = await page.locator('#executorPickerButton').evaluate(element => element.getBoundingClientRect().height);
    assert.ok(settingsSelectMetrics.every(metric => Math.abs(metric.height - executorHeight) <= 1), 'settings selectors must use the executor control height');
    assert.ok(settingsSelectMetrics.every(metric => Math.abs(metric.fontSize - metric.executorFontSize) <= 0.1), 'settings selects must match the executor value font size');
    const actionWidths = await page.evaluate(() => { const download = document.getElementById('downloadXlsxBtn').getBoundingClientRect(), reset = document.getElementById('resetBtn').getBoundingClientRect(); return { download: download.width, reset: reset.width, topDifference: Math.abs(download.top - reset.top) }; });
    assert.ok(actionWidths.download / actionWidths.reset > 1.85 && actionWidths.download / actionWidths.reset < 2.15, 'download and reset actions must use a 2/3 to 1/3 ratio');
    assert.ok(actionWidths.topDifference <= 1, 'download and reset actions must stay on one row');
    for (const legend of await page.locator('legend.semantic-legend').all()) {
      const box = await legend.boundingBox(); assert.ok(box && box.width <= 1 && box.height <= 1, 'semantic legend must be visually hidden');
    }
    const describedBy = await page.locator('#serviceName').getAttribute('aria-describedby');
    assert.match(describedBy || '', /serviceNameFeedback/); assert.match(describedBy || '', /serviceNameCount/);

    await fill(page, { ...validData, actDate: '2026-08-31' });
    const calculations = await page.evaluate(() => {
      const api = window.__ACTS_TEST_API__;
      return {
        words: [0, 1.01, 2.02, 1000, 123456789.99, 1.999].map(api.moneyWords),
        vat22: api.vatCalc(45000, 22), vat5: api.vatCalc(45000, 5)
      };
    });
    assert.deepEqual(calculations.words, [
      '0 (Ноль) руб. 00 коп.', '1 (Один) руб. 01 коп.', '2 (Два) руб. 02 коп.',
      '1 000 (Одна тысяча) руб. 00 коп.',
      '123 456 789 (Сто двадцать три миллиона четыреста пятьдесят шесть тысяч семьсот восемьдесят девять) руб. 99 коп.',
      '2 (Два) руб. 00 коп.'
    ]);
    assert.equal(calculations.vat22, 8114.75); assert.equal(calculations.vat5, 2142.86);
    await page.locator('#downloadXlsxBtn').evaluate(button => button.click());
    assert.match(await page.locator('#validationList').innerText(), /Дата акта не может быть раньше даты договора/);
    await page.locator('#actDate').fill(validData.actDate);
    assert.equal(await page.locator('#actDate').inputValue(), validData.actDate);

    await page.locator('#customerName').fill('Иванов 123');
    const nameValidation = await page.evaluate(() => window.__ACTS_WORKSPACE_TEST_API__.semanticErrors().map(error => `${error.key}:${error.message}`));
    assert.ok(nameValidation.some(error => error.includes('customerName:Проверьте формат имени')), nameValidation.join('\n'));
    await page.locator('#downloadXlsxBtn').evaluate(button => button.click());
    assert.match(await page.locator('#validationList').innerText(), /Проверьте формат имени/);
    await page.locator('#customerName').fill(validData.customerName);

    await page.locator('#customerBasis').fill('...');
    await page.locator('#downloadXlsxBtn').evaluate(button => button.click());
    assert.match(await page.locator('#validationList').innerText(), /содержательное основание полномочий/);
    await page.locator('#customerBasis').fill(validData.customerBasis);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#downloadXlsxBtn').click();
    const download = await downloadPromise;
    const xlsxPath = path.join(outputDir, download.suggestedFilename());
    await download.saveAs(xlsxPath);
    assert.ok(fs.statSync(xlsxPath).size > 10000);

    await page.locator('#repeatActBtn').click();
    assert.equal(await page.locator('#contractNumber').inputValue(), '');
    assert.equal(await page.locator('#contractDate').inputValue(), '');
    assert.equal(await page.locator('#actDate').inputValue(), '');
    assert.equal(await page.locator('#customer').inputValue(), validData.customer);

    await page.locator('#customer').fill('');
    await page.locator('#xlsxFileInput').setInputFiles(xlsxPath);
    await page.waitForFunction(expected => document.getElementById('customer').value === expected, validData.customer);
    assert.equal(await page.locator('#contractNumber').inputValue(), validData.contractNumber);
    assert.equal(await page.locator('#customerName').inputValue(), validData.customerName);
    assert.equal(await page.locator('#serviceName').inputValue(), validData.serviceName);

    await page.locator('#saveCustomerBtn').click();
    await page.locator('#saveServiceBtn').click();
    assert.equal(await page.locator('#customerCardOptions .library-option').count(), 1);
    assert.equal(await page.locator('#serviceTemplateOptions .library-option').count(), 1);
    const libraryTypography = await page.locator('#customerCardOptions .library-option-primary').evaluate(element => ({ fontSize: parseFloat(getComputedStyle(element).fontSize), fontWeight: Number(getComputedStyle(element).fontWeight), fieldFontSize: parseFloat(getComputedStyle(document.getElementById('customerCardSelect')).fontSize) }));
    assert.equal(libraryTypography.fontSize, libraryTypography.fieldFontSize, 'library entries must use the same font size as their fields');
    assert.ok(libraryTypography.fontWeight <= 500, 'library entries must not introduce heavy bold text');
    assert.deepEqual(await page.evaluate(() => { const card = window.__ACTS_WORKSPACE_TEST_API__.getState().customerCards[0]; return { customer: card.customer, position: card.position, name: card.name, basis: card.basis }; }), { customer: validData.customer, position: validData.customerPosition, name: validData.customerName, basis: validData.customerBasis });
    assert.equal(await page.locator('label[for="serviceTemplateSelect"]').count(), 0);
    assert.equal(await page.locator('.service-entry-title label').innerText(), 'Наименование оказанных услуг по договору');
    assert.equal(await page.locator('label[for="serviceName"]').count(), 1);
    assert.equal(await page.getByText('Введите вручную', { exact: true }).count(), 0);
    await page.locator('#customer').fill(''); await page.locator('#customerPosition').fill(''); await page.locator('#customerName').fill(''); await page.locator('#customerBasis').fill('');
    await page.locator('#customerCardSelect').fill(validData.customer);
    await page.locator('#customerCardSelect').press('ArrowDown');
    await page.locator('#customerCardSelect').press('Enter');
    assert.equal(await page.locator('#customer').inputValue(), validData.customer);
    assert.equal(await page.locator('#customerPosition').inputValue(), validData.customerPosition);
    assert.equal(await page.locator('#customerName').inputValue(), validData.customerName);
    assert.equal(await page.locator('#customerBasis').inputValue(), validData.customerBasis);
    await page.locator('#serviceName').fill('');
    await page.locator('#serviceTemplateSelect').fill(validData.serviceName);
    await page.locator('#serviceTemplateOptions .library-option').click();
    assert.equal(await page.locator('#serviceName').inputValue(), validData.serviceName);

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.locator('#customerCardSelect').focus();
    const darkListColors = await page.locator('#customerCardOptions').evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
    assert.equal(darkListColors.background, 'rgb(255, 255, 255)');
    assert.equal(darkListColors.color, 'rgb(23, 43, 77)');
    await page.emulateMedia({ colorScheme: 'light' });

    await page.locator('#customer').fill('ООО «Исправленный заказчик»');
    await page.locator('#customerBasis').fill('доверенности № 10');
    await page.locator('#updateCustomerBtn').click();
    assert.deepEqual(await page.evaluate(() => { const card = window.__ACTS_WORKSPACE_TEST_API__.getState().customerCards[0]; return { customer: card.customer, position: card.position, name: card.name, basis: card.basis }; }), { customer: 'ООО «Исправленный заказчик»', position: validData.customerPosition, name: validData.customerName, basis: 'доверенности № 10' });
    page.once('dialog', dialog => dialog.accept()); await page.locator('#deleteCustomerBtn').click();
    assert.equal((await page.evaluate(() => window.__ACTS_WORKSPACE_TEST_API__.getState())).customerCards.length, 0);
    await page.locator('#customer').fill(validData.customer); await page.locator('#customerPosition').fill(validData.customerPosition); await page.locator('#customerName').fill(validData.customerName); await page.locator('#customerBasis').fill(validData.customerBasis); await page.locator('#saveCustomerBtn').click();

    await page.locator('#serviceName').fill(`${validData.serviceName} - уточнено`);
    await page.locator('#updateServiceBtn').click();
    assert.equal((await page.evaluate(() => window.__ACTS_WORKSPACE_TEST_API__.getState())).serviceTemplates[0], `${validData.serviceName} - уточнено`);
    page.once('dialog', dialog => dialog.accept()); await page.locator('#deleteServiceBtn').click();
    assert.equal((await page.evaluate(() => window.__ACTS_WORKSPACE_TEST_API__.getState())).serviceTemplates.length, 0);
    await page.locator('#serviceName').fill(validData.serviceName); await page.locator('#saveServiceBtn').click();

    for (const executor of ['rrms', 'rrs', 'rrPoa']) {
      await page.locator('#executor').selectOption(executor);
      if (executor === 'rrPoa') {
        await page.locator('#assocPosition').fill('директор по сертификации');
        await page.locator('#assocName').fill('П.П. Петров');
        await page.locator('#assocBasis').fill('доверенности № 15 от 1 сентября 2026 г.');
      }
      const executorModel = await page.evaluate(() => { const text = window.__ACTS_TEST_API__.docTexts(); return { rate: text.ex.vatRate, signer: text.signer }; });
      assert.equal(executorModel.rate, executor === 'rrPoa' ? 22 : 5);
      assert.equal(executorModel.signer, executor === 'rrms' ? 'Е.А. Владимирцева' : executor === 'rrPoa' ? 'П.П. Петров' : 'А.В. Владимирцев');
      const nextDownload = page.waitForEvent('download');
      await page.locator('#downloadXlsxBtn').click();
      const result = await nextDownload;
      const resultPath = path.join(outputDir, `${executor}.xlsx`);
      await result.saveAs(resultPath);
      assert.ok(fs.statSync(resultPath).size > 10000);
      if (executor === 'rrPoa') {
        await page.locator('#executor').selectOption('rr');
        await page.locator('#xlsxFileInput').setInputFiles(resultPath);
        await page.waitForFunction(() => document.getElementById('executor').value === 'rrPoa');
        assert.equal(await page.locator('#assocName').inputValue(), 'П.П. Петров');
        assert.equal(await page.locator('#assocBasis').inputValue(), 'доверенности № 15 от 1 сентября 2026 г.');
        assert.equal(await page.locator('#executorSignerCardOptions .library-option').count(), 1);
        await page.locator('#assocPosition').fill(''); await page.locator('#assocName').fill(''); await page.locator('#assocBasis').fill('');
        assert.equal(await page.locator('#executorSignerCardOptions .library-option').innerText(), 'П.П. Петров');
        assert.equal(await page.locator('#executorSignerCardOptions .library-option-secondary').count(), 0);
        await page.locator('#executorSignerCardSelect').fill('П.П. Петров');
        await page.locator('#executorSignerCardOptions .library-option').click();
        assert.equal(await page.locator('#executorSignerCardSelect').inputValue(), 'П.П. Петров');
        assert.equal(await page.locator('#assocPosition').inputValue(), 'директор по сертификации');
        assert.equal(await page.locator('#assocBasis').inputValue(), 'доверенности № 15 от 1 сентября 2026 г.');
        await page.locator('#assocBasis').fill('доверенности № 16 от 2 сентября 2026 г.');
        await page.locator('#updateExecutorSignerBtn').click();
        assert.equal((await page.evaluate(() => window.__ACTS_WORKSPACE_TEST_API__.getState())).executorSignerCards[0].basis, 'доверенности № 16 от 2 сентября 2026 г.');
        page.once('dialog', dialog => dialog.accept()); await page.locator('#deleteExecutorSignerBtn').click();
        assert.equal((await page.evaluate(() => window.__ACTS_WORKSPACE_TEST_API__.getState())).executorSignerCards.length, 0);
        await page.locator('#assocBasis').fill('доверенности № 15 от 1 сентября 2026 г.'); await page.locator('#saveExecutorSignerBtn').click();
      }
    }

    await page.locator('#defaultsBtn').click();
    await page.locator('#defaultCity').fill('Москва');
    await page.locator('#defaultServicePlace').fill('Москва, Россия');
    await page.locator('#defaultDateMode').selectOption('today');
    await page.locator('#saveDefaultsBtn').click();
    assert.deepEqual(await page.locator('#retentionDays option').allInnerTexts(), ['30 дней', 'Полгода', '1 год', 'Навсегда']);
    await page.locator('#retentionDays').selectOption('183');
    assert.equal((await page.evaluate(() => window.__ACTS_WORKSPACE_TEST_API__.getPreferences())).retentionDays, 183);
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    assert.equal((await page.evaluate(() => window.__ACTS_WORKSPACE_TEST_API__.getPreferences())).retentionDays, 'always');
    assert.equal(await page.locator('#retentionDays').inputValue(), 'always');
    assert.match(await page.locator('#privacyText').innerText(), /без ограничения срока/);

    await page.locator('#newDraftBtn').click();
    await page.locator('#draftNameInput').fill('Второй акт');
    await page.locator('#saveDraftNameBtn').click();
    assert.equal(await page.locator('#activeDraftLabel').innerText(), 'Второй акт');
    assert.equal(await page.locator('#draftSelect option').count(), 2);
    assert.equal(await page.locator('#city').inputValue(), 'Москва');
    assert.equal(await page.locator('#servicePlace').inputValue(), 'Москва, Россия');
    assert.equal(await page.locator('#actDate').inputValue(), await page.evaluate(() => { const date = new Date(); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }));
    await page.locator('#executor').selectOption('rrs');
    assert.equal(await page.locator('#contractNumber').getAttribute('placeholder'), '26.001.01.026РРС');
    await page.locator('#customer').fill('ООО «Второй заказчик»');
    await page.locator('#draftPickerButton').click();
    await page.locator('#draftPickerOptions .library-option').filter({ hasText: 'Основной черновик' }).click();
    assert.equal(await page.locator('#customer').inputValue(), validData.customer);
    assert.equal(await page.locator('#contractNumber').getAttribute('placeholder'), '26.001.01.026РР');
    await page.locator('#draftPickerButton').click();
    await page.locator('#draftPickerOptions .library-option').filter({ hasText: 'Второй акт' }).click();
    assert.equal(await page.locator('#customer').inputValue(), 'ООО «Второй заказчик»');
    assert.equal(await page.locator('#contractNumber').getAttribute('placeholder'), '26.001.01.026РРС');

    const backupPromise = page.waitForEvent('download');
    await page.locator('#exportBackupBtn').click();
    const backupDownload = await backupPromise;
    const backupPath = path.join(outputDir, backupDownload.suggestedFilename());
    await backupDownload.saveAs(backupPath);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    assert.equal(backup.format, 'acts-constructor-backup');
    assert.equal(backup.data.drafts.length, 2);
    assert.equal('signerCards' in backup.data, false);
    assert.equal(backup.data.customerCards[0].name, validData.customerName);
    assert.equal(backup.data.executorSignerCards.length, 1);
    assert.equal(backup.data.serviceTemplates.length, 1);
    const legacyBackup = structuredClone(backup);
    legacyBackup.data.customerCards = [{ customer: validData.customer }];
    legacyBackup.data.signerCards = [{ name: validData.customerName, position: validData.customerPosition, basis: validData.customerBasis }];
    const migratedLegacyCard = await page.evaluate(text => {
      const state = window.__ACTS_WORKSPACE_TEST_API__.parseBackup(text).state;
      return { card: state.customerCards[0], hasSignerCards: 'signerCards' in state };
    }, JSON.stringify(legacyBackup));
    assert.deepEqual({ customer: migratedLegacyCard.card.customer, position: migratedLegacyCard.card.position, name: migratedLegacyCard.card.name, basis: migratedLegacyCard.card.basis }, { customer: validData.customer, position: validData.customerPosition, name: validData.customerName, basis: validData.customerBasis });
    assert.equal(migratedLegacyCard.hasSignerCards, false);
    await page.locator('#customer').fill('Поврежденные данные');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#backupFileInput').setInputFiles(backupPath);
    await page.waitForFunction(() => document.getElementById('customer').value === 'ООО «Второй заказчик»');
    assert.equal((await page.evaluate(() => window.__ACTS_WORKSPACE_TEST_API__.getState())).drafts.length, 2);

    await page.evaluate(() => {
      localStorage.setItem('actsInstalledUnlimitedV1', '1');
      localStorage.removeItem('actsInstalledRetentionDefaultV3');
      const prefs = JSON.parse(localStorage.getItem('actsWorkspacePreferencesV1')); prefs.retentionDays = 30;
      localStorage.setItem('actsWorkspacePreferencesV1', JSON.stringify(prefs));
      const state = JSON.parse(localStorage.getItem('actsWorkspaceDataV1')); state.updatedAt = '2000-01-01T00:00:00.000Z';
      [...state.customerCards, ...state.executorSignerCards].forEach(card => delete card.id);
      localStorage.setItem('actsWorkspaceDataV1', JSON.stringify(state));
      const form = JSON.parse(localStorage.getItem('actsGeneratorSettingsV10')); if (form) { form.savedAt = '2000-01-01T00:00:00.000Z'; localStorage.setItem('actsGeneratorSettingsV10', JSON.stringify(form)); }
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#workTools').evaluate(element => { element.open = true; });
    assert.equal(await page.evaluate(() => window.__ACTS_INSTALLED__), true);
    assert.equal(await page.locator('#retentionDays').inputValue(), 'always');
    const migratedState = await page.evaluate(() => window.__ACTS_WORKSPACE_TEST_API__.getState());
    assert.equal(migratedState.drafts.length, 2);
    assert.equal('signerCards' in migratedState, false);
    assert.ok([...migratedState.customerCards, ...migratedState.executorSignerCards].every(card => typeof card.id === 'string' && card.id.length > 0));

    await page.locator('#storageEnabled').uncheck();
    const storage = await page.evaluate(() => ({ allowed: window.__ACTS_STORAGE_ALLOWED__, data: localStorage.getItem('actsWorkspaceDataV1'), form: localStorage.getItem('actsGeneratorSettingsV10') }));
    assert.equal(storage.allowed, false); assert.equal(storage.data, null); assert.equal(storage.form, null);

    const retentionContext = await browser.newContext();
    const retentionPage = await retentionContext.newPage();
    await retentionPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await retentionPage.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('actsWorkspacePreferencesV1', JSON.stringify({ storageEnabled: true, retentionDays: 30, defaults: { city: '', servicePlace: '', dateMode: 'blank' } }));
    });
    await retentionPage.reload({ waitUntil: 'networkidle' });
    assert.equal(await retentionPage.locator('#retentionDays').inputValue(), 'always', 'the new browser default must migrate an old default to forever once');
    const retentionScenarios = [
      { retentionDays: 30, ageDays: 29, survives: true },
      { retentionDays: 30, ageDays: 31, survives: false },
      { retentionDays: 183, ageDays: 180, survives: true },
      { retentionDays: 183, ageDays: 184, survives: false },
      { retentionDays: 365, ageDays: 360, survives: true },
      { retentionDays: 365, ageDays: 366, survives: false },
      { retentionDays: 'always', ageDays: 5000, survives: true }
    ];
    for (const scenario of retentionScenarios) {
      await retentionPage.evaluate(({ retentionDays, ageDays }) => {
        const updatedAt = new Date(Date.now() - ageDays * 86400000).toISOString();
        const fields = {
          executor: 'rr', assocPosition: '', assocName: '', assocBasis: '', actDate: '', city: '',
          customer: 'ООО «Маркер хранения»', contractNumber: '', contractDate: '', customerPosition: 'директор',
          customerName: 'И.И. Иванов', customerBasis: 'Устава', servicePlace: '', amount: '', serviceName: ''
        };
        localStorage.clear();
        localStorage.setItem('actsRetentionDefaultAlwaysV3', '1');
        localStorage.setItem('actsWorkspacePreferencesV1', JSON.stringify({ storageEnabled: true, retentionDays, defaults: { city: '', servicePlace: '', dateMode: 'blank' } }));
        localStorage.setItem('actsWorkspaceDataV1', JSON.stringify({
          version: 3, updatedAt, activeDraftId: 'main',
          drafts: [{ id: 'main', name: 'Проверка хранения', fields, updatedAt }],
          customerCards: [{ id: 'marker', customer: fields.customer, position: fields.customerPosition, name: fields.customerName, basis: fields.customerBasis, updatedAt }],
          executorSignerCards: [], serviceTemplates: [], lastAct: null
        }));
        localStorage.setItem('actsGeneratorSettingsV10', JSON.stringify({ version: '3.0', savedAt: updatedAt, fields }));
      }, scenario);
      await retentionPage.reload({ waitUntil: 'networkidle' });
      const retained = await retentionPage.evaluate(() => ({
        customer: document.getElementById('customer').value,
        cards: window.__ACTS_WORKSPACE_TEST_API__.getState().customerCards.length,
        retentionDays: window.__ACTS_WORKSPACE_TEST_API__.getPreferences().retentionDays,
        legacyFormStored: localStorage.getItem('actsGeneratorSettingsV10') !== null
      }));
      assert.equal(String(retained.retentionDays), String(scenario.retentionDays));
      assert.equal(retained.customer === 'ООО «Маркер хранения»', scenario.survives, `form retention must be enforced for ${scenario.retentionDays} days at age ${scenario.ageDays}`);
      assert.equal(retained.cards === 1, scenario.survives, `library retention must be enforced for ${scenario.retentionDays} days at age ${scenario.ageDays}`);
      assert.equal(retained.legacyFormStored, scenario.survives, `legacy form storage must be removed when ${scenario.retentionDays}-day retention expires`);
    }
    await retentionContext.close();

    const socialPreview = await page.evaluate(() => new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = reject; image.src = 'preview-v2.8.png';
    }));
    assert.deepEqual(socialPreview, { width: 1200, height: 630 });
    const heroArtwork = await page.evaluate(() => new Promise((resolve, reject) => {
      const image = document.querySelector('.hero-skyline img');
      const done = () => resolve({ src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight });
      if (image.complete && image.naturalWidth) done(); else { image.addEventListener('load', done, { once: true }); image.addEventListener('error', reject, { once: true }); }
    }));
    assert.deepEqual(heroArtwork, { src: 'assets/hero-city-color-v2.10.png', width: 2172, height: 724 });
    assert.match(fs.readFileSync(path.join(root, 'assets', 'styles-v2.9.css'), 'utf8'), /::-webkit-date-and-time-value\{[^}]*align-items:center/);

    await page.locator('#workTools').evaluate(element => { element.open = false; });
    await page.locator('#executor').selectOption('rr');

    assert.equal(await page.locator('#actForm .privacy-note').count(), 0, 'storage notice must not remain inside the form');
    assert.equal(await page.locator('.site-footer #privacyText').count(), 1, 'storage notice must be placed in the footer');
    const footerRects = await page.locator('.site-footer > *:visible').evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; }));
    assert.ok(Math.max(...footerRects.map(rect => rect.top)) < Math.min(...footerRects.map(rect => rect.bottom)), 'desktop footer content must stay in one row');

    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }, { width: 402, height: 874 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport); await page.waitForTimeout(120);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      assert.equal(overflow, false, `horizontal overflow at ${viewport.width}px`);
      const containment = await page.evaluate(() => [...document.querySelectorAll('.form-section')].flatMap(section => {
        const bounds = section.getBoundingClientRect();
        return [...section.querySelectorAll('input:not([type="file"]), textarea, .executor-trigger, .library-actions')].filter(element => element.getClientRects().length > 0).map(element => {
          const rect = element.getBoundingClientRect();
          return { name: element.id || element.className, left: rect.left, right: rect.right, sectionLeft: bounds.left, sectionRight: bounds.right };
        });
      }));
      containment.forEach(rect => {
        assert.ok(rect.left >= rect.sectionLeft - 1, `${rect.name} must remain inside its section on the left at ${viewport.width}px`);
        assert.ok(rect.right <= rect.sectionRight + 1, `${rect.name} must remain inside its section on the right at ${viewport.width}px`);
      });
      if (viewport.width >= 1180) {
        if (viewport.width === 1920) await page.screenshot({ path: path.join(outputDir, 'desktop-full-hd.png'), fullPage: true });
        if (viewport.width === 1366) await page.screenshot({ path: path.join(outputDir, 'desktop-1366-viewport.png'), fullPage: false });
        const desktopMetrics = await page.evaluate(() => ({ appWidth: document.querySelector('.app-shell').getBoundingClientRect().width, heroHeight: document.querySelector('.hero').getBoundingClientRect().height, formHeight: document.querySelector('#actForm').scrollHeight, formPanelHeight: document.querySelector('.form-panel').getBoundingClientRect().height, previewPanelHeight: document.querySelector('.preview-panel').getBoundingClientRect().height, inputHeight: document.querySelector('#city').getBoundingClientRect().height, inputSize: parseFloat(getComputedStyle(document.querySelector('#city')).fontSize), labelSize: parseFloat(getComputedStyle(document.querySelector('label[for="city"]')).fontSize) }));
        assert.ok(desktopMetrics.appWidth >= Math.min(1660, viewport.width - 20) - 2, `workspace must use available Full HD width at ${viewport.width}px`);
        assert.ok(desktopMetrics.heroHeight <= 90, `hero must stay compact at ${viewport.width}px, got ${desktopMetrics.heroHeight}px`);
        assert.ok(desktopMetrics.inputHeight <= 38, `inputs must stay compact at ${viewport.width}px`);
        assert.ok(desktopMetrics.labelSize >= 12, 'labels must remain readable');
        assert.ok(Math.abs(desktopMetrics.inputSize - desktopMetrics.labelSize) <= 1.5, 'field labels and values must share one readable scale');
        assert.ok(Math.abs(desktopMetrics.formPanelHeight - desktopMetrics.previewPanelHeight) <= 1, `desktop panels must have equal heights at ${viewport.width}px`);
        if (viewport.width === 1920) assert.ok(desktopMetrics.formHeight <= 920, `Full HD form must be compact, got ${desktopMetrics.formHeight}px`);
      }
      if (viewport.width === 1024) await page.screenshot({ path: path.join(outputDir, 'desktop-1024-viewport.png'), fullPage: false });
      if (viewport.width <= 402) {
        await page.locator('#executor').selectOption('rrPoa');
        const executorLabelFits = await page.locator('#executorPickerLabel').evaluate(element => element.scrollWidth <= element.clientWidth + 1);
        assert.equal(executorLabelFits, true, 'full executor name must remain readable on mobile');
        const mobileMetrics = await page.evaluate(() => {
          const dates = ['actDate', 'contractDate'].map(id => {
            const field = document.getElementById(id), section = field.closest('.form-section');
            return { id, field: field.getBoundingClientRect(), section: section.getBoundingClientRect() };
          });
          const panelStyle = getComputedStyle(document.querySelector('.panel'));
          const skylineStyle = getComputedStyle(document.querySelector('.hero-skyline'));
          return { dates: dates.map(({ id, field, section }) => ({ id, left: field.left, right: field.right, sectionLeft: section.left, sectionRight: section.right })), backdrop: panelStyle.backdropFilter || panelStyle.webkitBackdropFilter, mask: skylineStyle.maskImage || skylineStyle.webkitMaskImage };
        });
        mobileMetrics.dates.forEach(rect => { assert.ok(rect.left >= rect.sectionLeft - 1, `${rect.id} must not overflow left`); assert.ok(rect.right <= rect.sectionRight + 1, `${rect.id} must not overflow right`); });
        assert.equal(mobileMetrics.backdrop, 'none');
        assert.equal(mobileMetrics.mask, 'none');
        await page.screenshot({ path: path.join(outputDir, `mobile-${viewport.width}.png`), fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: path.join(outputDir, 'desktop.png'), fullPage: true });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    const caches = await page.evaluate(() => window.caches.keys());
    assert.ok(caches.includes('acts-constructor-v3.0.0-20260913-r6'));
    await context.setOffline(true);
    const offlinePage = await context.newPage();
    await offlinePage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    assert.equal(await offlinePage.evaluate(() => window.__ACTS_TEST_API__?.APP_VERSION), '3.0');
    assert.ok(await offlinePage.evaluate(() => Array.isArray(window.XLSX_TEMPLATE_ENTRIES) && window.XLSX_TEMPLATE_ENTRIES.length > 0));
    await offlinePage.close();
    await context.setOffline(false);
    assert.deepEqual(pageErrors, []);
    process.stdout.write(JSON.stringify({ ok: true, outputDir, xlsxPath }, null, 2) + '\n');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
})().catch(error => { process.stderr.write((error.stack || String(error)) + '\n'); process.exitCode = 1; });
