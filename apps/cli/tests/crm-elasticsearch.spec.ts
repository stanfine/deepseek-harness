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
    amountMeaning: 'Order facts.', dimensions: { province: 'province', channel: 'channel' },
    measures: { orderCount: 'orderCount', quantity: 'skuQuantity' }, previewFields: [],
  }, order_items: { index: 'test_order_items', timeField: 'time', amountField: 'amount', customerField: 'customerId',
    amountMeaning: 'Order line items.', dimensions: { series: 'series', sku: 'sku' }, measures: { quantity: 'quantity' }, previewFields: [],
  } },
  report: { fiscalYearStartMonth: 4, orderFactsDataset: 'order_facts', orderItemsDataset: 'order_items', weeklyMultipleOrdersAreRepeatPurchasers: false },
  excel: { maxRecommendations: 2, maxRecommendationChars: 100, downloadBaseUrl: 'http://127.0.0.1:3080' },
  semantic: {
    maxSelectedMetrics: 5, maxDimensions: 2, maxFilters: 4, maxTopN: 10,
    maxFilterValues: 20, maxInputChars: 128, maxRequestBytes: 8192, timeGrains: ['day', 'week', 'month'],
    metrics: [
      { id: 'sales_amount', name: '销售额', dataset: 'order_facts', kind: 'sum', field: 'amount', format: 'currency',
        description: 'Configured order amount.', limitations: ['Source accounting semantics are unverified.'] },
      { id: 'order_count', name: '订单数', dataset: 'order_facts', kind: 'sum', field: 'orderCount', format: 'number',
        description: 'Configured order count.', limitations: ['Source order definition is unverified.'] },
      { id: 'item_quantity', name: '商品件数', dataset: 'order_items', kind: 'sum', field: 'quantity', format: 'number',
        description: 'Configured item quantity.', limitations: ['Line items are not orders.'] },
    ],
    dimensions: [
      { id: 'province', name: '省份', dataset: 'order_facts', field: 'province', dataType: 'keyword', filters: ['equals', 'in'],
        description: 'Configured province.', limitations: [] },
      { id: 'channel', name: '渠道', dataset: 'order_facts', field: 'channel', dataType: 'keyword', filters: ['equals', 'in'],
        description: 'Configured channel.', limitations: [] },
    ],
  },
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

function objectKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(objectKeys)
  return Object.entries(value).flatMap(([key, nested]) => [key, ...objectKeys(nested)])
}

describe('CRM Elasticsearch reader', () => {
  it('enforces the configured final semantic projection budget only on analysis tools', async () => {
    const endpoint = await fixture((_req, res) => res.end(JSON.stringify(response({
      source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') },
      current: { doc_count: 3, m0: { value: 120 }, m0_missing: { doc_count: 0 } },
    }))))
    const ctx = new Context()
    ctx.provide('connection', { fetch: { register: () => () => {} } } as never)
    const previousUser = process.env.TEST_USER, previousPassword = process.env.TEST_PASSWORD
    Object.assign(process.env, env)
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      const bounded = { ...config, endpoint, maxResponseBytes: 2500, semantic: { ...config.semantic,
        metrics: config.semantic.metrics.map((metric, index) => index === 0
          ? { ...metric, description: 'x'.repeat(385) } : metric) } }
      await ctx.plugin(CrmTools, bounded)
      const catalog = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('bounded-catalog'),
        name: 'crm_metric_catalog', arguments: {} })
      expect(catalog.isError).toBe(false)
      const analysis = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('bounded-analysis'),
        name: 'crm_analyze', arguments: { metrics: ['sales_amount'], start: '2025-01-01', end: '2025-02-01', intent: 'summary' } })
      expect(analysis.isError).toBe(true)
      expect(JSON.stringify(analysis)).toMatch(/tool projection byte limit exceeded/)
    } finally {
      if (previousUser === undefined) delete process.env.TEST_USER; else process.env.TEST_USER = previousUser
      if (previousPassword === undefined) delete process.env.TEST_PASSWORD; else process.env.TEST_PASSWORD = previousPassword
      await ctx.fiber.dispose()
    }
  })

  it('rejects unknown semantic metric kinds during plugin configuration', async () => {
    const ctx = new Context()
    ctx.provide('connection', { fetch: { register: () => () => {} } } as never)
    const previousUser = process.env.TEST_USER, previousPassword = process.env.TEST_PASSWORD
    Object.assign(process.env, env)
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      const invalid = { ...config, semantic: { ...config.semantic, metrics: [
        { ...config.semantic.metrics[0]!, kind: 'average' },
      ] } }
      const load = async () => { await ctx.plugin(CrmTools, invalid) }
      await expect(load()).rejects.toThrow(/Unknown metric kind/)
    } finally {
      if (previousUser === undefined) delete process.env.TEST_USER; else process.env.TEST_USER = previousUser
      if (previousPassword === undefined) delete process.env.TEST_PASSWORD; else process.env.TEST_PASSWORD = previousPassword
      await ctx.fiber.dispose()
    }
  })

  it('registers scoped tools and runs a canonical result through the actual tool runtime', async () => {
    let requestCount = 0
    const endpoint = await fixture(async (req, res) => {
      requestCount += 1
      let text = ''; for await (const chunk of req) text += String(chunk)
      const body = JSON.parse(text) as { aggs?: Record<string, unknown> }
      if (body.aggs?.current) {
        const current = body.aggs.current as { aggs?: Record<string, unknown> }
        const grouped = current.aggs?.d0 !== undefined
        const firstGroup = current.aggs?.d0 as { aggs?: Record<string, unknown> } | undefined
        const nested = firstGroup?.aggs?.d1 !== undefined
        res.end(JSON.stringify(response({ source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') },
          current: grouped
            ? { doc_count: 3, d0: { sum_other_doc_count: 0, doc_count_error_upper_bound: 0,
              buckets: [{ key: '浙江', doc_count: 3, ...(nested ? { d1: { sum_other_doc_count: 0, doc_count_error_upper_bound: 0,
                buckets: [{ key: '门店', doc_count: 3, m0: { value: 120 }, m0_missing: { doc_count: 0 } }] }, d1_missing: { doc_count: 0 } }
                : { m0: { value: 120 }, m0_missing: { doc_count: 0 } }) }] }, d0_missing: { doc_count: 0 } }
            : { doc_count: 3, m0: { value: 120 }, m0_missing: { doc_count: 0 } },
        })))
      } else res.end(JSON.stringify(response({ amount: { count: 3, sum: 120, avg: 40, min: 10, max: 70 } })))
    })
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
        'crm_catalog', 'crm_profile', 'crm_query', 'crm_metric_catalog', 'crm_dimension_catalog', 'crm_analyze', 'crm_drilldown',
        'crm_report_periods', 'crm_sales_report', 'crm_lifecycle_report', 'crm_product_report', 'crm_export_weekly_excel',
      ])
      const semanticSchemas = ctx.tools.schemas().filter(tool => tool.name.startsWith('crm_') &&
        ['crm_metric_catalog', 'crm_dimension_catalog', 'crm_analyze', 'crm_drilldown'].includes(tool.name))
      expect(objectKeys(semanticSchemas)).not.toEqual(expect.arrayContaining(['index', 'field', 'script', 'formula', 'dsl', 'path']))
      const metricCatalog = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('crm-metrics'),
        name: 'crm_metric_catalog', arguments: {} })
      const dimensionCatalog = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('crm-dimensions'),
        name: 'crm_dimension_catalog', arguments: {} })
      expect((metricCatalog.value as { metrics: Array<{ id: string }> }).metrics.map(metric => metric.id)).toContain('sales_amount')
      expect((dimensionCatalog.value as { dimensions: Array<{ id: string }> }).dimensions.map(dimension => dimension.id)).toContain('province')
      expect(objectKeys([metricCatalog.value, dimensionCatalog.value]))
        .not.toEqual(expect.arrayContaining(['index', 'field', 'script', 'formula', 'dsl', 'path']))
      const analysis = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('crm-analysis'),
        name: 'crm_analyze', arguments: { metrics: ['sales_amount'], dimensions: ['province'], start: '2025-01-01',
          end: '2025-02-01', intent: 'ranking', sort: { metric: 'sales_amount', direction: 'desc' }, limit: 5 } })
      expect(analysis.isError, JSON.stringify(analysis)).toBe(false)
      expect(analysis.meta).toMatchObject({ crmAnalysis: { version: 1,
        request: { metrics: ['sales_amount'], dimensions: ['province'], intent: 'ranking' },
        data: { version: 1, rows: [{ dimensions: { province: '浙江' } }] } } })
      const drilldown = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('crm-drilldown'),
        name: 'crm_drilldown', arguments: { metrics: ['sales_amount'], dimensions: ['province'], drilldownDimension: 'channel',
          parentFilters: [{ dimension: 'province', values: ['浙江'] }], start: '2025-01-01', end: '2025-02-01',
          intent: 'ranking', limit: 5 } })
      expect(drilldown.isError).toBe(false)
      expect(drilldown.meta).toMatchObject({ crmAnalysis: { version: 1,
        request: { dimensions: ['province', 'channel'], filters: [{ dimension: 'province', operator: 'in', values: ['浙江'] }] },
        data: { version: 1, rows: [{ dimensions: { province: '浙江', channel: '门店' } }] } } })
      const beforeRejected = requestCount
      const rejectedRequests = [
        { name: 'crm_analyze', arguments: { metrics: ['sales_amount', 'item_quantity'], start: '2025-01-01',
          end: '2025-02-01', intent: 'summary' } },
        { name: 'crm_analyze', arguments: { metrics: ['sales_amount'], start: '2025-01-01', end: '2025-02-01',
          intent: 'summary', path: '/private' } },
        { name: 'crm_analyze', arguments: { metrics: ['sales_amount'], dimensions: ['province'], start: '2025-01-01',
          end: '2025-02-01', intent: 'ranking', drilldownDimension: 'channel',
          parentFilters: [{ dimension: 'province', values: ['浙江'] }] } },
        { name: 'crm_analyze', arguments: { metrics: ['sales_amount'], start: '2025-01-01', end: '2025-02-01',
          intent: 'summary', filters: [{ dimension: 'province', operator: 'equals', value: '浙江', script: 'x' }] } },
        { name: 'crm_analyze', arguments: { metrics: ['sales_amount'], start: '2025-01-01', end: '2025-02-01',
          intent: 'summary', filters: [{ dimension: 'province', operator: 'equals', value: 'x'.repeat(129) }] } },
        { name: 'crm_analyze', arguments: { metrics: ['sales_amount'], start: '2025-01-01', end: '2025-02-01',
          intent: 'summary', filters: [{ dimension: 'province', operator: 'in', values: Array.from({ length: 21 }, (_, index) => `v${index}`) }] } },
        { name: 'crm_drilldown', arguments: { metrics: ['sales_amount'], dimensions: ['province'], drilldownDimension: 'channel',
          parentFilters: [{ dimension: 'province', values: Array.from({ length: 21 }, (_, index) => `v${index}`) }],
          start: '2025-01-01', end: '2025-02-01', intent: 'ranking' } },
        { name: 'crm_analyze', arguments: { metrics: ['sales_amount'], start: '2025-01-01', end: '2025-02-01', intent: 'summary',
          filters: Array.from({ length: 4 }, () => ({ dimension: 'province', operator: 'in',
            values: Array.from({ length: 20 }, (_, index) => `${index}-${'x'.repeat(100)}`) })) } },
      ] as const
      for (const [index, request] of rejectedRequests.entries()) {
        const rejected = await ctx.tools.execute({ signal: new AbortController().signal,
          callId: ToolCallId(`crm-rejected-${index}`), ...request })
        expect(rejected.isError).toBe(true)
      }
      expect(requestCount).toBe(beforeRejected)
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
