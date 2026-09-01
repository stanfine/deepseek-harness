/** Opt-in source integration: aggregate-only probes, no model calls or personal rows. */
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { Config } from '../config/examples/crm/crm-tools.ts'
import { ElasticsearchReader, resolveConfig, type ReaderConfig } from '../config/examples/crm/elasticsearch.ts'
import { resolveReportPeriods } from '../config/examples/crm/report-periods.ts'
import { WeeklyReportReader } from '../config/examples/crm/weekly-report.ts'

it.skipIf(process.env.DSH_CRM_LIVE_TEST !== '1')('reads aggregate coverage through the configured CRM adapter', async () => {
  const source = fileURLToPath(new URL('../config/examples/crm/presets/crm/agent.cordis.yml', import.meta.url))
  const row = loadOverlayPatches('CRM live test', source).find(entry => entry.id === 'crm-tools')
  const endpoint = process.env.DSH_CRM_ES_URL
  if (!endpoint) throw new Error('DSH_CRM_ES_URL is required for the live test')
  const config = Config({ ...row?.config as ReaderConfig,
    endpoint,
    allowHttp: process.env.DSH_CRM_ALLOW_HTTP === 'true',
  }) as ReaderConfig
  const reader = new ElasticsearchReader(resolveConfig(config, process.env))
  const signal = AbortSignal.timeout(config.timeoutMs)
  for (const dataset of ['orders', 'members']) {
    expect(await reader.profile(dataset, signal)).toHaveProperty('recordCount')
    expect(await reader.query({ dataset, mode: 'summary', start: '2025-03-01', end: '2025-04-01' }, signal))
      .toMatchObject({ dataset })
    expect(await reader.query({ dataset, mode: 'trend', interval: 'day', start: '2025-03-01', end: '2025-04-01' }, signal))
      .toHaveProperty('buckets.length', 31)
    expect(await reader.query({ dataset, mode: 'group', dimension: 'channel', start: '2025-03-01', end: '2025-04-01' }, signal))
      .toHaveProperty('missingDimension')
  }
  const facts = config.datasets.order_facts!, items = config.datasets.order_items!
  const weekly = new WeeklyReportReader({ timeZone: config.timeZone, timeoutMs: config.timeoutMs, maxBuckets: config.maxBuckets,
    distinctPageSize: config.distinctPageSize, maxDistinctPages: config.maxDistinctPages,
    fiscalYearStartMonth: config.report!.fiscalYearStartMonth,
    ...(config.report!.lifecycleHistoryCompleteFrom === undefined ? {}
      : { lifecycleHistoryCompleteFrom: config.report!.lifecycleHistoryCompleteFrom }),
    weeklyMultipleOrdersAreRepeatPurchasers: config.report!.weeklyMultipleOrdersAreRepeatPurchasers,
    orderFacts: { dataset: 'order_facts', timeField: facts.timeField, customerField: facts.customerField!, amountField: facts.amountField!,
      orderCountField: facts.measures!.orderCount!, quantityField: facts.measures!.quantity! },
    orderItems: { dataset: 'order_items', timeField: items.timeField, amountField: items.amountField!, quantityField: items.measures!.quantity!,
      seriesField: items.dimensions.series!, skuField: items.dimensions.sku! },
  }, (dataset, body, currentSignal) => reader.searchConfigured(dataset, body, currentSignal))
  const periods = resolveReportPeriods('2025-04-30', config.timeZone, config.report!.fiscalYearStartMonth, '2025-05-20')
  const sales = await weekly.sales(periods, signal)
  expect(sales.rows.find(row => row.period === 'current')).toMatchObject({ available: true, exactCustomers: true })
  expect(JSON.stringify(sales)).not.toContain('customerId')
  await expect(weekly.lifecycle(periods, signal)).resolves.toMatchObject({ available: false, observedStart: '2024-12-04' })
  await expect(weekly.products(periods, 'series', signal)).resolves.toMatchObject({ available: false, groupBy: 'series' })
  await expect(weekly.products(periods, 'sku', signal)).resolves.toMatchObject({ available: true, groupBy: 'sku' })
}, 60_000)
