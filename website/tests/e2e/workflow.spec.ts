import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createPublishedAnalysis } from '../../src/engine/analysis.ts';
import { analysisWorkbook } from '../../src/io/workbook.ts';
import { readWorkbook, writeWorkbook } from '../../src/io/xlsx.ts';

const nav = (page: import('@playwright/test').Page, name: string) => page.locator('.main-nav').getByRole('button', { name });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'RCA Score Calculator', exact: true })).toBeVisible();
});

test('published example computes real scores, comparison and pair audit without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await nav(page, 'Results').click();
  await expect(page.locator('.results-table tbody tr')).toHaveCount(5);
  await expect(page.locator('.results-table tbody tr').first()).toContainText('Nivolumab+ipilimumab');
  await expect(page.locator('.results-table tbody tr').first()).toContainText('6');
  await page.getByRole('button', { name: '95% interval-exclusion coding', exact: true }).click();
  await expect(page.locator('.results-table tbody tr').first()).toContainText('3');
  await nav(page, 'Compare').click();
  await expect(page.locator('.compare-table tbody tr')).toHaveCount(5);
  await nav(page, 'Results').click();
  await page.getByRole('button', { name: 'Point-estimate coding', exact: true }).click();
  await page.locator('.results-table tbody tr').first().getByRole('button', { name: 'Details' }).click();
  await expect(page.getByRole('heading', { name: 'Calculation audit' })).toBeVisible();
  await expect(page.locator('.formula-list')).toContainText('RCA_cob = 6');
  await expect(page.locator('.card').filter({ has: page.getByRole('heading', { name: '2 · Pairwise contributions' }) }).locator('tbody tr')).toHaveCount(6);
  expect(errors).toEqual([]);
});

test('blank manual analysis calculates both rules and responds to a null-touching interval', async ({ page }) => {
  await page.getByRole('button', { name: 'New blank analysis' }).click();
  await page.getByLabel(/Common comparator/).fill('Placebo');
  await nav(page, 'Data').click();
  for (const endpoint of ['OS', 'PFS']) {
    await page.getByLabel(`Intervention 1 ${endpoint} effect`, { exact: true }).fill('0.5');
    await page.getByLabel(`Intervention 1 ${endpoint} lci`, { exact: true }).fill('0.4');
    await page.getByLabel(`Intervention 1 ${endpoint} uci`, { exact: true }).fill('0.6');
  }
  await nav(page, 'Results').click();
  await expect(page.locator('.results-table tbody tr').first()).toContainText('2 / 1');
  await expect(page.locator('.results-table tbody tr').first()).toContainText('2');
  await page.getByRole('button', { name: '95% interval-exclusion coding', exact: true }).click();
  await expect(page.locator('.results-table tbody tr').first()).toContainText('2');
  await nav(page, 'Data').click();
  await page.getByLabel('Intervention 1 OS uci', { exact: true }).fill('1');
  await nav(page, 'Compare').click();
  await expect(page.locator('.compare-table tbody tr').first()).toContainText('0');
  await nav(page, 'Audit').click();
  await page.getByRole('button', { name: 'Interval exclusion', exact: true }).click();
  await expect(page.locator('.reason-cell').first()).toContainText('touches null');
});

test('browser save, modify and reload restores exact analysis; delete removes saved record', async ({ page }) => {
  await nav(page, 'Save & export').click();
  await page.getByLabel('Saved analysis name').fill('E2E saved RCA');
  await page.getByRole('button', { name: 'Save / overwrite' }).click();
  await expect(page.locator('.saved-list')).toContainText('E2E saved RCA');
  await nav(page, 'Setup').click();
  await page.getByLabel(/Common comparator/).fill('Changed comparator');
  await nav(page, 'Save & export').click();
  await page.locator('.saved-list').getByRole('button', { name: 'Load', exact: true }).click();
  await nav(page, 'Setup').click();
  await expect(page.getByLabel(/Common comparator/)).toHaveValue('Common reference comparator (see source NMA)');
  await nav(page, 'Save & export').click();
  await page.locator('.saved-list').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.saved-list')).toContainText('No saved analyses yet.');
});

test('JSON and Excel downloads contain complete reproducible inputs and can be reloaded', async ({ page }, testInfo) => {
  await nav(page, 'Save & export').click();
  const jsonDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export complete JSON' }).click();
  const jsonDownload = await jsonDownloadPromise;
  const jsonPath = testInfo.outputPath('analysis.json');
  await jsonDownload.saveAs(jsonPath);
  const json = JSON.parse(await readFile(jsonPath, 'utf8'));
  expect(json.reproducibility.canonicalSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(json.endpoints).toHaveLength(4);
  expect(json.interventions).toHaveLength(5);

  const excelDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export results & audit Excel' }).click();
  const excelDownload = await excelDownloadPromise;
  const excelPath = testInfo.outputPath('analysis.xlsx');
  await excelDownload.saveAs(excelPath);
  const workbook = readWorkbook(await readFile(excelPath));
  expect(workbook.map((sheet) => sheet.name)).toContain('Pair audit');
  expect(workbook.find((sheet) => sheet.name === 'Effects')?.rows).toHaveLength(21);

  await page.getByLabel('Reload analysis JSON file').setInputFiles(jsonPath);
  await expect(page.locator('.notice')).toContainText('inputs, parameters and versions were restored');
  const excelBuffer = await readFile(excelPath);
  await nav(page, 'Data').click();
  await page.getByLabel('Import Excel file').setInputFiles({ name: 'roundtrip.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: excelBuffer });
  await expect(page.locator('.notice')).toContainText('Both rules were recalculated');
  await nav(page, 'Setup').click();
  await expect(page.getByLabel('Analysis name')).toHaveValue('Yanagisawa 2024 mRCC');
});

test('exported workbook import and mobile layout remain usable', async ({ page }) => {
  const analysis = createPublishedAnalysis('mori-2022-prostate');
  const buffer = Buffer.from(analysisWorkbook(analysis));
  await nav(page, 'Data').click();
  await page.getByLabel('Import Excel file').setInputFiles({ name: 'mori.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  await expect(page.locator('.notice')).toContainText('Imported mori.xlsx');
  await nav(page, 'Results').click();
  await expect(page.locator('.results-table tbody tr')).toHaveCount(4);
  await page.setViewportSize({ width: 390, height: 844 });
  await nav(page, 'Setup').click();
  await expect(page.getByLabel(/Common comparator/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'New blank analysis' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});


test('original RCA workbook layout imports and calculates in the browser', async ({ page }) => {
  const native = writeWorkbook([
    { name: '1-Setup', rows: [
      ['Setup'], ['Comparator:', 'Chemotherapy'], ['n', 2], ['m', 2, 'Apply weights?', 'No'], [], ['ID', 'Name', 'Direction', 'Null', 'Weight', 'Statistic'],
      ['E1', 'OS', 'Lower', 1, '', 'HR'], ['E2', 'PFS', 'Lower', 1, '', 'HR'],
      ...Array.from({ length: 18 }, () => []), ['Interventions'], ['ID', 'Name'], ['T1', 'Regimen A'], ['T2', 'Regimen B'],
    ] },
    { name: '2-Input_NMA_Data', rows: [[], [], ['Regimen A', 0.5, 0.3, 0.8, 0.7, 0.5, 1], ['Regimen B', 1, 0.6, 1.4, 1.2, 1.01, 1.5]] },
  ]);
  await nav(page, 'Data').click();
  await page.getByLabel('Import Excel file').setInputFiles({ name: 'native-rca.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(native) });
  await expect(page.locator('.notice')).toContainText('Imported native-rca.xlsx');
  await nav(page, 'Results').click();
  await expect(page.locator('.results-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.results-table tbody tr').first()).toContainText('Regimen A');
  await page.getByRole('button', { name: '95% interval-exclusion coding', exact: true }).click();
  await expect(page.locator('.results-table tbody tr').first()).toContainText('2 / 1');
});
