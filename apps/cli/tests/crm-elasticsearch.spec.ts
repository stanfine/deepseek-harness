/** Read-only CRM query, transport, and result-disclosure contracts. */
import { createServer, type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { ElasticsearchReader, resolveConfig } from '../config/examples/crm/elasticsearch.ts'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as CrmTools from '../config/examples/crm/crm-tools.ts'

const limits = { timeoutMs: 1000, maxResponseBytes: 16384, maxRangeDays: 366,
  maxRows: 10, maxBuckets: 10, distinctPageSize: 2, maxDistinctPages: 2 }
const config = {
  endpoint: 'http://127.0.0.1:9200', allowHttp: true, timeZone: '+08:00', usernameEnv: 'TEST_USER', passwordEnv: 'TEST_PASSWORD',
  ...limits,
  datasets: { orders: { index: 'test_orders', timeField: 'time', amountField: 'amount', customerField: 'customerId',
    amountMeaning: 'Stored order amount; refund and currency semantics unverified.',
    dimensions: { channel: 'channelId' }, previewFields: ['time', 'amount', 'items.category', 'items.amount'],
    latestVersionField: 'latest',
  }, order_facts: { index: 'test_order_facts', timeField: 'orderDate', amountField: 'orderAmount', customerField: 'customerId',
    amountMeaning: 'Order facts.', dimensions: {}, measures: { orderCount: 'orderCount', quantity: 'skuQuantity' }, previewFields: [],
  }, order_items: { index: 'test_order_items', timeField: 'time', amountField: 'amount', customerField: 'customerId',
    amountMeaning: 'Order line items.', dimensions: { series: 'series', sku: 'sku' }, measures: { quantity: 'quantity' }, previewFields: [],
  } },
  report: { fiscalYearStartMonth: 4, orderFactsDataset: 'order_facts', orderItemsDataset: 'order_items', weeklyMultipleOrdersAreRepeatPurchasers: false },
  excel: { maxRecommendations: 2, maxRecommendationChars: 100, downloadBaseUrl: 'http://127.0.0.1:3080' },
}
const env = { TEST_USER: 'fixture-user', TEST_PASSWORD: 'fixture-password' }
const response = (aggregations: object = {}, hits: object[] = []) => ({ timed_out: false, _shards: { failed: 0 },
  hits: { total: { value: 3, relation: 'eq' }, hits }, aggregations })
const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map(async (server) => {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
})) })
async function fixture(handler: (...args: Parameters<RequestListener>) => unknown) {
  const server = createServer((request, reply) => {
    Promise.resolve(handler(request, reply)).catch(() => { reply.writeHead(500); reply.end() })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('CRM Elasticsearch reader', () => {
  it('registers scoped tools and runs a canonical result through the actual tool runtime', async () => {
    const endpoint = await fixture((_req, res) => res.end(JSON.stringify(response({
      amount: { count: 3, sum: 120, avg: 40, min: 10, max: 70 },
    }))))
    const ctx = new Context()
    ctx.provide('connection', { fetch: { register: () => () => {} } } as never)
    const previousUser = process.env.TEST_USER, previousPassword = process.env.TEST_PASSWORD
    Object.assign(process.env, env)
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      const plugin = ctx.plugin(CrmTools, { ...config, endpoint })
      await plugin
      expect(ctx.tools.schemas().map(tool => tool.name)).toEqual([
        'crm_catalog', 'crm_profile', 'crm_query', 'crm_report_periods', 'crm_sales_report', 'crm_lifecycle_report', 'crm_product_report', 'crm_export_weekly_excel',
      ])
      const periods = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('crm-weekly-periods'),
        name: 'crm_report_periods', arguments: { date: '2025-05-07' } })
      expect(periods.value).toMatchObject({ current: { start: '2025-05-05', end: '2025-05-12' }, priorYear: { start: '2024-05-06' } })
      expect(periods.meta).toMatchObject({ crmReport: { version: 1, kind: 'periods', request: { date: '2025-05-07' } } })
      const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('crm-monthly'), name: 'crm_query',
        arguments: { dataset: 'orders', mode: 'summary', intent: 'comparison', chartType: 'bar', metric: 'amount', start: '2025-01-01', end: '2025-02-01' } })
      expect(result.isError).toBe(false)
      expect(result.value).toMatchObject({ recordCount: 3, amount: { sum: 120 } })
      expect(result.meta).toMatchObject({ crm: { version: 1, request: { mode: 'summary', intent: 'comparison', chartType: 'bar', metric: 'amount' }, data: { recordCount: 3, amount: { sum: 120 } } } })
      expect(JSON.stringify(result)).not.toContain('fixture-password')
      const invalid = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('crm-invalid-chart'), name: 'crm_query',
        arguments: { dataset: 'orders', mode: 'summary', chartType: 'javascript', start: '2025-01-01', end: '2025-02-01' } })
      expect(invalid.isError).toBe(true)
      await plugin.dispose()
      expect(ctx.tools.schemas()).toEqual([])
    } finally {
      if (previousUser === undefined) delete process.env.TEST_USER; else process.env.TEST_USER = previousUser
      if (previousPassword === undefined) delete process.env.TEST_PASSWORD; else process.env.TEST_PASSWORD = previousPassword
      await ctx.fiber.dispose()
    }
  })

  it('returns bounded daily trends including zero buckets in the configured time zone', async () => {
    let captured: Record<string, unknown> = {}
    const endpoint = await fixture(async (req, res) => {
      let body = ''; for await (const chunk of req) body += String(chunk)
      captured = JSON.parse(body) as Record<string, unknown>
      res.end(JSON.stringify(response({ trend: { buckets: [
        { key_as_string: '2025-01-01', doc_count: 3, amount: { count: 3, sum: 120, avg: 40, min: 10, max: 70 } },
        { key_as_string: '2025-01-02', doc_count: 0, amount: { count: 0, sum: 0, avg: null, min: null, max: null } },
      ] } })))
    })
    const reader = new ElasticsearchReader(resolveConfig({ ...config, endpoint }, env))
    const result = await reader.query({ dataset: 'orders', mode: 'trend', interval: 'day', start: '2025-01-01', end: '2025-01-03' }, new AbortController().signal)
    expect(result).toMatchObject({ interval: 'day', buckets: [{ key: '2025-01-01', recordCount: 3 }, { key: '2025-01-02', recordCount: 0 }] })
    expect(captured.aggs).toMatchObject({ trend: { date_histogram: { calendar_interval: 'day', time_zone: '+08:00', min_doc_count: 0, extended_bounds: { min: '2025-01-01', max: '2025-01-02' } } } })
    await expect(reader.query({ dataset: 'orders', mode: 'trend', interval: 'day', start: '2025-01-01', end: '2025-02-01' }, new AbortController().signal)).rejects.toThrow(/bucket/)
    await expect(reader.query({ dataset: 'orders', mode: 'trend', interval: 'hour', start: '2025-01-01', end: '2025-01-03' }, new AbortController().signal)).rejects.toThrow(/interval/)
  })

  it('reports top-bucket truncation instead of treating it as complete contribution', async () => {
    const endpoint = await fixture((_req, res) => res.end(JSON.stringify(response({ missingDimension: { doc_count: 1 }, groups: {
      sum_other_doc_count: 1, doc_count_error_upper_bound: 0,
      buckets: [{ key: 'pos', doc_count: 2, amount: { count: 2, sum: 100, avg: 50, min: 30, max: 70 } }],
    } }))))
    const reader = new ElasticsearchReader(resolveConfig({ ...config, endpoint }, env))
    const result = await reader.query({ dataset: 'orders', mode: 'group', dimension: 'channel', start: '2025-01-01', end: '2025-02-01' }, new AbortController().signal)
    expect(result).toMatchObject({ truncated: true, omitted: 1, missingDimension: 1, buckets: [{ key: 'pos', recordCount: 2 }] })
  })
  it('rejects credentials in URLs, insecure transport without opt-in and missing secrets', () => {
    expect(() => resolveConfig({ ...config, endpoint: 'http://u:p@localhost:9200' }, env)).toThrow(/URL/)
    expect(() => resolveConfig({ ...config, allowHttp: false }, env)).toThrow(/HTTPS/)
    expect(() => resolveConfig(config, {})).toThrow(/TEST_USER/)
    expect(() => resolveConfig({ ...config, datasets: { orders: { ...config.datasets.orders, index: '*' } } }, env)).toThrow(/index/)
  })

  it('counts member documents when the source has no amount aggregation', async () => {
    const endpoint = await fixture((_req, res) => res.end(JSON.stringify({ timed_out: false, _shards: { failed: 0 }, hits: { total: { value: 2, relation: 'eq' }, hits: [] } })))
    const { amountField: _amount, ...members } = config.datasets.orders
    const reader = new ElasticsearchReader(resolveConfig({ ...config, endpoint, datasets: { ...config.datasets, members } }, env))
    await expect(reader.query({ dataset: 'members', mode: 'summary', start: '2025-01-01', end: '2025-02-01' }, new AbortController().signal)).resolves.toMatchObject({ recordCount: 2, amount: null })
  })

  it('rejects invalid dates, windows and unknown fields before sending a request', async () => {
    const reader = new ElasticsearchReader(resolveConfig(config, env))
    for (const args of [
      { dataset: 'other', start: '2025-01-01', end: '2025-02-01', mode: 'summary' },
      { dataset: 'orders', start: '2025-02-30', end: '2025-03-01', mode: 'summary' },
      { dataset: 'orders', start: '2023-01-01', end: '2025-02-01', mode: 'summary' },
      { dataset: 'orders', start: '2025-01-01', end: '2025-02-01', mode: 'group', dimension: 'mobile' },
      { dataset: 'orders', start: '2025-01-01', end: '2025-02-01', mode: 'delete' },
    ]) await expect(reader.query(args, new AbortController().signal)).rejects.toThrow()
  })

  it('compiles summary queries using one index, fixed fields and an exclusive end date', async () => {
    let captured: Record<string, unknown> = {}
    const endpoint = await fixture(async (req, res) => {
      expect(req.url).toBe('/test_orders/_search')
      expect(req.method).toBe('POST')
      expect(req.headers.authorization).toMatch(/^Basic /)
      let body = ''; for await (const chunk of req) body += String(chunk)
      captured = JSON.parse(body) as Record<string, unknown>
      res.end(JSON.stringify(response({ amount: { count: 3, sum: 120, avg: 40, min: 10, max: 70 } })))
    })
    const reader = new ElasticsearchReader(resolveConfig({ ...config, endpoint }, env))
    const value = await reader.query({ dataset: 'orders', mode: 'summary', start: '2025-01-01', end: '2025-02-01', filters: [{ dimension: 'channel', value: 'pos' }] }, new AbortController().signal)
    expect(value).toMatchObject({ recordCount: 3, amount: { sum: 120 }, start: '2025-01-01', end: '2025-02-01' })
    expect(captured.query).toEqual({ bool: { filter: [{ term: { latest: true } }, { range: { time: { gte: '2025-01-01T00:00:00+08:00', lt: '2025-02-01T00:00:00+08:00' } } }, { term: { channelId: 'pos' } }] } })
    expect(JSON.stringify(value)).not.toContain('fixture-password')
  })

  it('projects only configured fields while preserving item relationships', async () => {
    const endpoint = await fixture((_req, res) => res.end(JSON.stringify(response({}, [{ _id: 'secret-id', _source: {
      time: '2025-01-01', amount: 25, mobile: 'private-phone', items: [{ category: 'skin', amount: 25, customerName: 'private-name' }],
    } }]))))
    const reader = new ElasticsearchReader(resolveConfig({ ...config, endpoint }, env))
    const value = await reader.query({ dataset: 'orders', mode: 'records', start: '2025-01-01', end: '2025-02-01' }, new AbortController().signal)
    expect(value).toMatchObject({ rows: [{ time: '2025-01-01', amount: 25, items: [{ category: 'skin', amount: 25 }] }], truncated: true })
    expect(JSON.stringify(value)).not.toMatch(/secret-id|private-phone|private-name/)
  })

  it('counts customers exactly across composite pages without returning identifiers', async () => {
    let page = 0
    const endpoint = await fixture((_req, res) => {
      const bucket = (id: string) => ({ key: { customer: id }, doc_count: 1 })
      res.end(JSON.stringify(response({ customers: page++ === 0
        ? { buckets: [bucket('a'), bucket('b')], after_key: { customer: 'b' } }
        : { buckets: [bucket('c')] } })))
    })
    const reader = new ElasticsearchReader(resolveConfig({ ...config, endpoint }, env))
    const value = await reader.query({ dataset: 'orders', mode: 'customers', start: '2025-01-01', end: '2025-02-01' }, new AbortController().signal)
    expect(value).toMatchObject({ customerCount: 3, exact: true })
    expect(value).not.toHaveProperty('buckets')
  })

  it('fails when exact customer counting exceeds its page budget', async () => {
    const endpoint = await fixture((_req, res) => res.end(JSON.stringify(response({ customers: {
      buckets: [{ key: { customer: 'a' }, doc_count: 1 }, { key: { customer: 'b' }, doc_count: 1 }], after_key: { customer: 'b' },
    } }))))
    const reader = new ElasticsearchReader(resolveConfig({ ...config, endpoint }, env))
    await expect(reader.query({ dataset: 'orders', mode: 'customers', start: '2025-01-01', end: '2025-02-01' }, new AbortController().signal)).rejects.toThrow(/budget/)
  })

  it.each([
    { ...response(), timed_out: true },
    { ...response(), _shards: { failed: 1 } },
  ])('rejects partial responses', async (payload) => {
    const endpoint = await fixture((_req, res) => res.end(JSON.stringify(payload)))
    const reader = new ElasticsearchReader(resolveConfig({ ...config, endpoint }, env))
    await expect(reader.profile('orders', new AbortController().signal)).rejects.toThrow(/incomplete/)
  })

  it('does not follow redirects or expose upstream error bodies', async () => {
    const endpoint = await fixture((_req, res) => { res.writeHead(302, { Location: 'http://elsewhere.invalid' }); res.end('fixture-password private upstream body') })
    const reader = new ElasticsearchReader(resolveConfig({ ...config, endpoint }, env))
    await expect(reader.profile('orders', new AbortController().signal)).rejects.toThrow('Elasticsearch HTTP 302')
  })

  it('enforces response byte limits and caller cancellation', async () => {
    const endpoint = await fixture((_req, res) => res.end('x'.repeat(20000)))
    const reader = new ElasticsearchReader(resolveConfig({ ...config, endpoint }, env))
    await expect(reader.profile('orders', new AbortController().signal)).rejects.toThrow(/byte limit/)
    const controller = new AbortController(); controller.abort()
    await expect(reader.profile('orders', controller.signal)).rejects.toThrow()
  })
})
