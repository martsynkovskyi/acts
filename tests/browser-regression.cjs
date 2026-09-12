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
const outputDir = process.env.QA_OUTPUT || path.join(os.tmpdir(), 'acts-v2.6-qa');
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

    assert.equal(await page.evaluate(() => window.__ACTS_TEST_API__?.APP_VERSION), '2.6');
    await page.locator('#workTools').evaluate(element => { element.open = true; });
    for (const [executor, placeholder] of Object.entries({ rr: '26.001.01.026РР', rrPoa: '26.001.01.026РР', rrms: '26.001.01.026РР-МС', rrs: '26.001.01.026РРС' })) {
      await page.locator('#executor').selectOption(executor);
      assert.equal(await page.locator('#contractNumber').getAttribute('placeholder'), placeholder);
    }
    await page.locator('#executor').selectOption('rr');
    assert.equal(await page.locator('.section-heading').count(), 3);
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
    await page.locator('#downloadXlsxBtn').click();
    assert.match(await page.locator('#validationList').innerText(), /Дата акта не может быть раньше даты договора/);
    await page.locator('#actDate').fill(validData.actDate);

    await page.locator('#customerName').fill('Иванов 123');
    await page.locator('#downloadXlsxBtn').click();
    assert.match(await page.locator('#validationList').innerText(), /Проверьте формат имени/);
    await page.locator('#customerName').fill(validData.customerName);

    await page.locator('#customerBasis').fill('...');
    await page.locator('#downloadXlsxBtn').click();
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
    await page.locator('#saveSignerBtn').click();
    await page.locator('#saveServiceBtn').click();
    assert.equal(await page.locator('#customerCardOptions option').count(), 1);
    assert.equal(await page.locator('#signerCardOptions option').count(), 1);
    assert.equal(await page.locator('#serviceTemplateOptions option').count(), 1);
    assert.equal(await page.locator('label[for="serviceTemplateSelect"]').innerText(), 'Типовые услуги');
    await page.locator('#customer').fill('');
    await page.locator('#customerCardSelect').fill(validData.customer);
    assert.equal(await page.locator('#customer').inputValue(), validData.customer);
    await page.locator('#customerPosition').fill(''); await page.locator('#customerName').fill(''); await page.locator('#customerBasis').fill('');
    await page.locator('#signerCardSelect').fill(`${validData.customerName} - ${validData.customerPosition} - ${validData.customerBasis}`);
    assert.equal(await page.locator('#customerPosition').inputValue(), validData.customerPosition);
    assert.equal(await page.locator('#customerBasis').inputValue(), validData.customerBasis);
    await page.locator('#serviceName').fill('');
    await page.locator('#serviceTemplateSelect').fill(validData.serviceName);
    assert.equal(await page.locator('#serviceName').inputValue(), validData.serviceName);

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
        assert.equal(await page.locator('#executorSignerCardOptions option').count(), 1);
        await page.locator('#assocPosition').fill(''); await page.locator('#assocName').fill(''); await page.locator('#assocBasis').fill('');
        await page.locator('#executorSignerCardSelect').fill('П.П. Петров - директор по сертификации - доверенности № 15 от 1 сентября 2026 г.');
        assert.equal(await page.locator('#assocPosition').inputValue(), 'директор по сертификации');
        assert.equal(await page.locator('#assocBasis').inputValue(), 'доверенности № 15 от 1 сентября 2026 г.');
      }
    }

    await page.locator('#defaultsBtn').click();
    await page.locator('#defaultCity').fill('Москва');
    await page.locator('#defaultServicePlace').fill('Москва, Россия');
    await page.locator('#defaultDateMode').selectOption('today');
    await page.locator('#retentionDays').selectOption('7');
    await page.locator('#saveDefaultsBtn').click();
    assert.equal((await page.evaluate(() => window.__ACTS_WORKSPACE_TEST_API__.getPreferences())).retentionDays, 7);

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
    await page.locator('#draftSelect').selectOption('main');
    assert.equal(await page.locator('#customer').inputValue(), validData.customer);
    assert.equal(await page.locator('#contractNumber').getAttribute('placeholder'), '26.001.01.026РР');
    await page.locator('#draftSelect').selectOption({ label: 'Второй акт' });
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
    assert.equal(backup.data.executorSignerCards.length, 1);
    assert.equal(backup.data.serviceTemplates.length, 1);
    await page.locator('#customer').fill('Поврежденные данные');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#backupFileInput').setInputFiles(backupPath);
    await page.waitForFunction(() => document.getElementById('customer').value === 'ООО «Второй заказчик»');
    assert.equal((await page.evaluate(() => window.__ACTS_WORKSPACE_TEST_API__.getState())).drafts.length, 2);

    await page.evaluate(() => {
      localStorage.setItem('actsInstalledUnlimitedV1', '1');
      const state = JSON.parse(localStorage.getItem('actsWorkspaceDataV1')); state.updatedAt = '2000-01-01T00:00:00.000Z'; localStorage.setItem('actsWorkspaceDataV1', JSON.stringify(state));
      const form = JSON.parse(localStorage.getItem('actsGeneratorSettingsV10')); if (form) { form.savedAt = '2000-01-01T00:00:00.000Z'; localStorage.setItem('actsGeneratorSettingsV10', JSON.stringify(form)); }
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#workTools').evaluate(element => { element.open = true; });
    assert.equal(await page.evaluate(() => window.__ACTS_INSTALLED__), true);
    assert.equal(await page.locator('#retentionLabel').innerText(), 'Срок хранения: без ограничения');
    assert.equal((await page.evaluate(() => window.__ACTS_WORKSPACE_TEST_API__.getState())).drafts.length, 2);

    await page.locator('#storageEnabled').uncheck();
    const storage = await page.evaluate(() => ({ allowed: window.__ACTS_STORAGE_ALLOWED__, data: localStorage.getItem('actsWorkspaceDataV1'), form: localStorage.getItem('actsGeneratorSettingsV10') }));
    assert.equal(storage.allowed, false); assert.equal(storage.data, null); assert.equal(storage.form, null);

    for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport); await page.waitForTimeout(120);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      assert.equal(overflow, false, `horizontal overflow at ${viewport.width}px`);
      if (viewport.width <= 390) await page.screenshot({ path: path.join(outputDir, `mobile-${viewport.width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: path.join(outputDir, 'desktop.png'), fullPage: true });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    const caches = await page.evaluate(() => window.caches.keys());
    assert.ok(caches.includes('acts-constructor-v2.6-20260912'));
    await context.setOffline(true);
    const offlinePage = await context.newPage();
    await offlinePage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    assert.equal(await offlinePage.evaluate(() => window.__ACTS_TEST_API__?.APP_VERSION), '2.6');
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
