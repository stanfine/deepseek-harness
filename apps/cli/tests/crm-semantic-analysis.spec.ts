/** Elasticsearch fixture coverage for the closed CRM semantic executor. */
import { createServer, type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { resolveAnalysisPlan, type AnalysisRequest, type DrilldownRequest } from '../config/examples/crm/analysis-planner.ts'
import { ElasticsearchReader, resolveConfig, type ReaderConfig } from '../config/examples/crm/elasticsearch.ts'
import { executeSemanticAnalysis } from '../config/examples/crm/semantic-analysis.ts'
import { assertSemanticToolProjectionSize, semanticToolProjection, semanticToolProjectionBytes } from '../config/examples/crm/crm-tools.ts'
import { resolveSemanticModel, type SemanticConfig } from '../config/examples/crm/semantic-model.ts'

const datasets: ReaderConfig['datasets'] = {
  facts: {
    index: 'private_crm_facts', timeField: 'private_order_date', amountField: 'private_amount', customerField: 'private_customer',
    latestVersionField: 'private_latest', amountMeaning: 'Configured order facts.',
    dimensions: { channel: 'private_channel', province: 'private_province' },
    measures: { orderCount: 'private_order_count' }, previewFields: [],
  },
}

function semanticConfig(): SemanticConfig {
  return {
    maxSelectedMetrics: 5, maxDimensions: 2, maxFilters: 4, maxTopN: 10,
    maxFilterValues: 20, maxInputChars: 128, maxRequestBytes: 8192, timeGrains: ['day', 'week', 'month'],
    metrics: [
      { id: 'sales_amount', name: '销售额', dataset: 'facts', kind: 'sum', field: 'amount', format: 'currency',
        description: 'Configured sales amount.', limitations: ['Accounting treatment requires source-owner confirmation.'] },
      { id: 'order_count', name: '订单数', dataset: 'facts', kind: 'sum', field: 'orderCount', format: 'number',
        description: 'Configured order count.', limitations: [] },
      { id: 'document_count', name: '记录数', dataset: 'facts', kind: 'count', format: 'number',
        description: 'Matching source documents.', limitations: ['Documents may not be unique orders.'] },
      { id: 'purchaser_count', name: '购买人数', dataset: 'facts', kind: 'distinct_count', field: 'customer', format: 'number',
        description: 'Distinct configured purchaser identifiers.', limitations: ['Missing identifiers are excluded.'] },
      { id: 'atv', name: '客单价', dataset: 'facts', kind: 'ratio', dependencies: ['sales_amount', 'order_count'], format: 'currency',
        description: 'Sales amount per order.', limitations: ['Unavailable when order count is zero.'] },
    ],
    dimensions: [
      { id: 'day', name: '日期', dataset: 'facts', field: 'time', dataType: 'date', filters: ['equals', 'in'],
        timeGrains: ['day', 'week', 'month'], description: 'Configured order date.', limitations: [] },
      { id: 'channel', name: '渠道', dataset: 'facts', field: 'channel', dataType: 'keyword', filters: ['equals', 'in'],
        description: 'Configured sales channel.', limitations: [] },
      { id: 'province', name: '省份', dataset: 'facts', field: 'province', dataType: 'keyword', filters: ['equals', 'in'],
        description: 'Configured province.', limitations: [] },
    ],
  }
}

const env = { SEMANTIC_USER: 'fixture-user', SEMANTIC_PASSWORD: 'fixture-password' }
const limits = { timeoutMs: 1000, maxResponseBytes: 16384, maxRangeDays: 366, maxRows: 10,
  maxBuckets: 10, distinctPageSize: 100, maxDistinctPages: 2 }
const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
  }))
})

async function fixture(handler: (...args: Parameters<RequestListener>) => unknown): Promise<string> {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(() => { response.writeHead(500); response.end() })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function elastic(aggregations: JsonValue, total = 3): JsonValue {
  const addCoverage = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) addCoverage(item); return }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) {
      const match = /^m(\d+)$/.exec(key)
      if (match && !Object.hasOwn(record, `${key}_missing`) && typeof record.doc_count === 'number') {
        record[`${key}_missing`] = { doc_count: 0 }
      }
      addCoverage(record[key])
    }
  }
  addCoverage(aggregations)
  return { timed_out: false, _shards: { failed: 0 }, hits: { total: { value: total, relation: 'eq' }, hits: [] }, aggregations }
}

function reader(endpoint: string, overrides: Partial<ReaderConfig> = {}): ElasticsearchReader {
  return new ElasticsearchReader(resolveConfig({
    endpoint, allowHttp: true, timeZone: '+08:00', usernameEnv: 'SEMANTIC_USER', passwordEnv: 'SEMANTIC_PASSWORD',
    ...limits, datasets, ...overrides,
  }, env))
}

function resolved(request: AnalysisRequest) {
  const model = resolveSemanticModel(semanticConfig(), datasets)
  return { model, plan: resolveAnalysisPlan(model, request, { maxRangeDays: limits.maxRangeDays, maxBuckets: limits.maxBuckets }) }
}

describe('CRM semantic analysis executor', () => {
  it('rejects a missing sum coverage companion instead of publishing an exact value', async () => {
    const endpoint = await fixture((_request, response) => response.end(JSON.stringify({ timed_out: false,
      _shards: { failed: 0 }, hits: { total: { value: 1, relation: 'eq' }, hits: [] }, aggregations: {
        source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') }, current: { doc_count: 1, m0: { value: 20 } },
      } })))
    const { model, plan } = resolved({ metrics: ['sales_amount'], start: '2025-05-01', end: '2025-06-01', intent: 'summary' })
    await expect(executeSemanticAnalysis(reader(endpoint), model, plan, new AbortController().signal))
      .rejects.toThrow(/aggregation response/i)
  })
  it('compiles exact configured filters and source measures without scripts or credentials', async () => {
    let body: Record<string, unknown> = {}
    let authorization = ''
    const endpoint = await fixture(async (request, response) => {
      expect(request.url).toBe('/private_crm_facts/_search')
      authorization = String(request.headers.authorization)
      let text = ''; for await (const chunk of request) text += String(chunk)
      body = JSON.parse(text) as Record<string, unknown>
      response.end(JSON.stringify(elastic({ source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') },
        current: { doc_count: 3, m0: { value: 120 }, m1: { value: 4 } } })))
    })
    const { model, plan } = resolved({ metrics: ['sales_amount', 'order_count', 'atv'], dimensions: [],
      filters: [{ dimension: 'channel', operator: 'equals', value: 'online' },
        { dimension: 'province', operator: 'in', values: ['浙江', '上海'] }],
      start: '2025-05-01', end: '2025-06-01', intent: 'summary' })

    const result = await executeSemanticAnalysis(reader(endpoint), model, plan, new AbortController().signal)

    expect(body).toEqual({
      size: 0,
      query: { bool: { filter: [
        { term: { private_latest: true } },
        { term: { private_channel: 'online' } },
        { terms: { private_province: ['浙江', '上海'] } },
      ] } },
      aggs: {
        source_coverage: { min: { field: 'private_order_date' } },
        current: { filter: { range: { private_order_date: { gte: '2025-05-01T00:00:00+08:00', lt: '2025-06-01T00:00:00+08:00' } } },
          aggs: { m0: { sum: { field: 'private_amount' } }, m0_missing: { missing: { field: 'private_amount' } },
            m1: { sum: { field: 'private_order_count' } }, m1_missing: { missing: { field: 'private_order_count' } } } },
      },
      track_total_hits: true,
    })
    expect(result.rows).toEqual([{ dimensions: {}, metrics: {
      sales_amount: { value: 120 }, order_count: { value: 4 }, atv: { value: 30 },
    } }])
    expect(JSON.stringify(result)).not.toMatch(/private_|fixture-password|fixture-user|Basic|_search|"script"/i)
    expect(authorization).toMatch(/^Basic /)
  })

  it('nests stable date and terms buckets and aligns grouped comparison rows', async () => {
    let body: Record<string, unknown> = {}
    const endpoint = await fixture(async (request, response) => {
      let text = ''; for await (const chunk of request) text += String(chunk)
      body = JSON.parse(text) as Record<string, unknown>
      const group = (day: string, first: [string, number], second: [string, number]) => ({
        key_as_string: day, doc_count: first[1] + second[1], d1: { sum_other_doc_count: 0, doc_count_error_upper_bound: 0,
          buckets: [first, second].map(([key, value]) => ({ key, doc_count: 1, m0: { value } })) }, d1_missing: { doc_count: 0 },
      })
      response.end(JSON.stringify(elastic({ source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') },
        current: { doc_count: 4, d0: { buckets: [group('2025-01-01', ['online', 20], ['store', 10])] }, d0_missing: { doc_count: 0 } },
        comparison: { doc_count: 4, d0: { buckets: [group('2024-12-01', ['online', 10], ['store', 20])] }, d0_missing: { doc_count: 0 } },
      })))
    })
    const { model, plan } = resolved({ metrics: ['sales_amount'], dimensions: ['day', 'channel'], timeGrain: 'month',
      start: '2025-01-01', end: '2025-02-01', comparison: 'previous_period', intent: 'comparison' })

    const result = await executeSemanticAnalysis(reader(endpoint), model, plan, new AbortController().signal)

    expect(body.aggs).toEqual({
      source_coverage: { min: { field: 'private_order_date' } },
      current: { filter: { range: { private_order_date: { gte: '2025-01-01T00:00:00+08:00', lt: '2025-02-01T00:00:00+08:00' } } }, aggs: {
        d0: { date_histogram: { field: 'private_order_date', calendar_interval: 'month', time_zone: '+08:00', format: 'yyyy-MM-dd',
          min_doc_count: 0, extended_bounds: { min: '2025-01-01', max: '2025-01-31' }, order: { _key: 'asc' } }, aggs: {
          d1: { terms: { field: 'private_channel', size: 10, show_term_doc_count_error: true, order: { _key: 'asc' } },
            aggs: { m0: { sum: { field: 'private_amount' } }, m0_missing: { missing: { field: 'private_amount' } } } },
          d1_missing: { missing: { field: 'private_channel' } },
        } }, d0_missing: { missing: { field: 'private_order_date' } },
      } },
      comparison: { filter: { range: { private_order_date: { gte: '2024-12-01T00:00:00+08:00', lt: '2025-01-01T00:00:00+08:00' } } }, aggs: {
        d0: { date_histogram: { field: 'private_order_date', calendar_interval: 'month', time_zone: '+08:00', format: 'yyyy-MM-dd',
          min_doc_count: 0, extended_bounds: { min: '2024-12-01', max: '2024-12-31' }, order: { _key: 'asc' } }, aggs: {
          d1: { terms: { field: 'private_channel', size: 10, show_term_doc_count_error: true, order: { _key: 'asc' } },
            aggs: { m0: { sum: { field: 'private_amount' } }, m0_missing: { missing: { field: 'private_amount' } } } },
          d1_missing: { missing: { field: 'private_channel' } },
        } }, d0_missing: { missing: { field: 'private_order_date' } },
      } },
    })
    expect(result.rows).toEqual([
      { dimensions: { day: '2025-01-01', channel: 'online' }, metrics: { sales_amount: { value: 20, comparisonValue: 10, changeRatio: 1 } } },
      { dimensions: { day: '2025-01-01', channel: 'store' }, metrics: { sales_amount: { value: 10, comparisonValue: 20, changeRatio: -0.5 } } },
    ])
    expect(result.drilldownDimensions).toEqual([])
  })

  it('returns null derived ratios and changes with concrete zero-denominator reasons', async () => {
    const endpoint = await fixture((_request, response) => response.end(JSON.stringify(elastic({
      source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') },
      current: { doc_count: 2, m0: { value: 100 }, m1: { value: 0 } },
      comparison: { doc_count: 2, m0: { value: 80 }, m1: { value: 0 } },
    }))))
    const { model, plan } = resolved({ metrics: ['atv'], start: '2025-05-01', end: '2025-06-01',
      comparison: 'previous_period', intent: 'comparison' })

    await expect(executeSemanticAnalysis(reader(endpoint), model, plan, new AbortController().signal)).resolves.toMatchObject({
      rows: [{ metrics: { atv: {
        value: null, comparisonValue: null, changeRatio: null, unavailableReason: 'order_count is zero',
        comparisonUnavailableReason: 'order_count is zero', changeUnavailableReason: 'current value is unavailable',
      } } }],
    })
  })

  it('discloses omitted, approximate, and missing terms buckets and sorts before Top N', async () => {
    const endpoint = await fixture((_request, response) => response.end(JSON.stringify(elastic({
      source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') },
      current: { doc_count: 9, d0: { sum_other_doc_count: 2, doc_count_error_upper_bound: 1, buckets: [
        { key: 'a', doc_count: 2, m0: { value: 20 } }, { key: 'b', doc_count: 5, m0: { value: 50 } },
        { key: 'c', doc_count: 1, m0: { value: 10 } },
      ] }, d0_missing: { doc_count: 1 } },
    }))))
    const { model, plan } = resolved({ metrics: ['sales_amount'], dimensions: ['channel'], start: '2025-05-01', end: '2025-06-01',
      intent: 'ranking', sort: { metric: 'sales_amount', direction: 'desc' }, limit: 2 })

    const result = await executeSemanticAnalysis(reader(endpoint), model, plan, new AbortController().signal)

    expect(result.rows.map(row => row.dimensions.channel)).toEqual(['b', 'a'])
    expect(result.completeness).toMatchObject({ complete: false, missingDimensionDocuments: 1,
      omittedDocuments: 2, limitedRows: 1, countErrorUpperBound: 1 })
    expect(result.warnings.join(' ')).toMatch(/missing|omitted|error bound/i)
  })

  it('marks a prior-year comparison unavailable when observed history starts too late', async () => {
    const endpoint = await fixture((_request, response) => response.end(JSON.stringify(elastic({
      source_coverage: { value: Date.parse('2025-01-01T00:00:00Z') },
      current: { doc_count: 3, m0: { value: 120 } }, comparison: { doc_count: 0, m0: { value: 0 } },
    }))))
    const { model, plan } = resolved({ metrics: ['sales_amount'], start: '2025-05-01', end: '2025-06-01',
      comparison: 'prior_year', intent: 'comparison' })

    const result = await executeSemanticAnalysis(reader(endpoint), model, plan, new AbortController().signal)

    expect(result.coverage.comparison).toMatchObject({ available: false, start: '2024-05-02', end: '2024-06-02', observedStart: '2025-01-01' })
    expect(result.rows[0]?.metrics.sales_amount).toMatchObject({ value: 120, comparisonValue: null, changeRatio: null,
      comparisonUnavailableReason: 'Source history does not cover the comparison start', changeUnavailableReason: 'comparison value is unavailable' })
    expect(result.completeness.complete).toBe(false)
  })

  it('counts distinct configured identifiers exactly across bounded composite pages', async () => {
    const bodies: Record<string, unknown>[] = []
    const endpoint = await fixture(async (request, response) => {
      let text = ''; for await (const chunk of request) text += String(chunk)
      const body = JSON.parse(text) as Record<string, unknown>
      bodies.push(body)
      if ((body.aggs as Record<string, unknown>).current) {
        response.end(JSON.stringify(elastic({ source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') },
          current: { doc_count: 3 } })))
      } else {
        const page = bodies.length - 1
        response.end(JSON.stringify(elastic({ distinct: page === 1 ? {
          buckets: [{ key: { customer: 'private-customer-a' } }], after_key: { customer: 'private-customer-a' },
        } : { buckets: [
          { key: { customer: 'private-customer-b' } }, { key: { customer: 'private-customer-c' } },
        ] } })))
      }
    })
    const { model, plan } = resolved({ metrics: ['purchaser_count'], start: '2025-05-01', end: '2025-06-01', intent: 'summary' })
    const result = await executeSemanticAnalysis(reader(endpoint), model, plan, new AbortController().signal)
    expect(result.rows[0]?.metrics.purchaser_count).toEqual({ value: 3 })
    expect(result.completeness).toMatchObject({ complete: true, approximateMetrics: [] })
    expect(bodies).toHaveLength(3)
    expect(bodies[1]).toMatchObject({ size: 0, query: { bool: { filter: [
      { term: { private_latest: true } },
      { range: { private_order_date: { gte: '2025-05-01T00:00:00+08:00', lt: '2025-06-01T00:00:00+08:00' } } },
    ] } }, aggs: { distinct: { composite: { size: 100, sources: [
      { customer: { terms: { field: 'private_customer' } } },
    ] } } } })
    expect(JSON.stringify(result)).not.toContain('private-customer')
  })

  it('keeps a reserved customer dimension separate from the distinct identifier field', async () => {
    let requestedField = ''
    const endpoint = await fixture(async (request, response) => {
      let text = ''; for await (const chunk of request) text += String(chunk)
      const body = JSON.parse(text) as { aggs: { current: { aggs: { d0: { terms: { field: string } } } } } }
      requestedField = body.aggs.current.aggs.d0.terms.field
      const key = requestedField === 'private_customer' ? 'raw-customer-secret' : 'safe-segment'
      response.end(JSON.stringify(elastic({ source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') },
        current: { doc_count: 1, d0: { sum_other_doc_count: 0, doc_count_error_upper_bound: 0,
          buckets: [{ key, doc_count: 1, m0: { value: 20 } }] }, d0_missing: { doc_count: 0 } } })))
    })
    const collisionDatasets: ReaderConfig['datasets'] = { facts: { ...datasets.facts!, dimensions: {
      ...datasets.facts!.dimensions, customer: 'private_customer_segment',
    } } }
    const config = semanticConfig()
    config.dimensions.push({ id: 'customer_segment', name: '客户分组', dataset: 'facts', field: 'customer', dataType: 'keyword',
      filters: ['equals', 'in'], description: 'Configured non-identifying customer segment.', limitations: [] })
    const model = resolveSemanticModel(config, collisionDatasets)
    const plan = resolveAnalysisPlan(model, { metrics: ['sales_amount'], dimensions: ['customer_segment'],
      start: '2025-05-01', end: '2025-06-01', intent: 'ranking' }, limits)

    const result = await executeSemanticAnalysis(reader(endpoint, { datasets: collisionDatasets }), model, plan,
      new AbortController().signal)

    expect(requestedField).toBe('private_customer_segment')
    expect(result.rows[0]?.dimensions.customer_segment).toBe('safe-segment')
    expect(JSON.stringify(result)).not.toContain('raw-customer-secret')
  })

  it('normalizes partial-month comparisons and includes comparison-only groups', async () => {
    const endpoint = await fixture((_request, response) => {
      const group = (key: string, buckets: { key: string; value: number }[]) => ({ key_as_string: key, doc_count: buckets.length,
        d1: { sum_other_doc_count: 0, doc_count_error_upper_bound: 0,
          buckets: buckets.map(bucket => ({ key: bucket.key, doc_count: 1, m0: { value: bucket.value } })) },
        d1_missing: { doc_count: 0 } })
      response.end(JSON.stringify(elastic({ source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') },
        current: { doc_count: 3, d0: { buckets: [
          group('2025-05-01', [{ key: 'online', value: 10 }]), group('2025-06-01', [{ key: 'online', value: 20 }]),
          group('2025-07-01', [{ key: 'online', value: 30 }]),
        ] }, d0_missing: { doc_count: 0 } },
        comparison: { doc_count: 4, d0: { buckets: [
          group('2025-03-01', [{ key: 'legacy', value: 7 }, { key: 'online', value: 5 }]),
          group('2025-04-01', [{ key: 'online', value: 10 }]), group('2025-05-01', [{ key: 'online', value: 15 }]),
        ] }, d0_missing: { doc_count: 0 } },
      })))
    })
    const { model, plan } = resolved({ metrics: ['sales_amount'], dimensions: ['day', 'channel'], timeGrain: 'month',
      start: '2025-05-15', end: '2025-07-10', comparison: 'previous_period', intent: 'comparison' })

    const result = await executeSemanticAnalysis(reader(endpoint), model, plan, new AbortController().signal)

    expect(result.rows).toEqual([
      { dimensions: { day: '2025-05-01', channel: 'online' }, metrics: {
        sales_amount: { value: 10, comparisonValue: 5, changeRatio: 1 },
      } },
      { dimensions: { day: '2025-05-01', channel: 'legacy' }, metrics: { sales_amount: {
        value: null, unavailableReason: 'current bucket is unavailable', comparisonValue: 7, changeRatio: null,
        changeUnavailableReason: 'current value is unavailable',
      } } },
      { dimensions: { day: '2025-06-01', channel: 'online' }, metrics: {
        sales_amount: { value: 20, comparisonValue: 10, changeRatio: 1 },
      } },
      { dimensions: { day: '2025-07-01', channel: 'online' }, metrics: {
        sales_amount: { value: 30, comparisonValue: 15, changeRatio: 1 },
      } },
    ])
  })

  it('rejects a partial-week response whose calendar bucket sequence has a gap', async () => {
    const endpoint = await fixture((_request, response) => {
      const bucket = (key: string) => ({ key_as_string: key, doc_count: 1, m0: { value: 1 } })
      response.end(JSON.stringify(elastic({ source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') },
        current: { doc_count: 3, d0: { buckets: [bucket('2025-05-05'), bucket('2025-05-12'), bucket('2025-05-19')] },
          d0_missing: { doc_count: 0 } },
        comparison: { doc_count: 2, d0: { buckets: [bucket('2025-04-21'), bucket('2025-05-05')] },
          d0_missing: { doc_count: 0 } },
      })))
    })
    const { model, plan } = resolved({ metrics: ['sales_amount'], dimensions: ['day'], timeGrain: 'week',
      start: '2025-05-07', end: '2025-05-20', comparison: 'previous_period', intent: 'trend' })

    await expect(executeSemanticAnalysis(reader(endpoint), model, plan, new AbortController().signal))
      .rejects.toThrow(/calendar bucket sequence/)
  })

  it('preserves an extra relative comparison period when shifted month bucket counts differ', async () => {
    const endpoint = await fixture((_request, response) => {
      const bucket = (key: string, value: number) => ({ key_as_string: key, doc_count: value, m0: { value } })
      response.end(JSON.stringify(elastic({ source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') },
        current: { doc_count: 31, d0: { buckets: [bucket('2025-05-01', 31)] }, d0_missing: { doc_count: 0 } },
        comparison: { doc_count: 31, d0: { buckets: [bucket('2025-03-01', 1), bucket('2025-04-01', 30)] },
          d0_missing: { doc_count: 0 } },
      })))
    })
    const { model, plan } = resolved({ metrics: ['sales_amount'], dimensions: ['day'], timeGrain: 'month',
      start: '2025-05-01', end: '2025-06-01', comparison: 'previous_period', intent: 'trend' })

    const result = await executeSemanticAnalysis(reader(endpoint), model, plan, new AbortController().signal)

    expect(result.rows).toEqual([
      { dimensions: { day: '2025-05-01' }, metrics: { sales_amount: { value: 31, comparisonValue: 1, changeRatio: 30 } } },
      { dimensions: { day: '2025-06-01' }, metrics: { sales_amount: {
        value: null, unavailableReason: 'current bucket is unavailable', comparisonValue: 30, changeRatio: null,
        changeUnavailableReason: 'current value is unavailable',
      } } },
    ])
    expect(result.completeness.complete).toBe(false)
    expect(result.warnings).toContain('One or more comparison rows have no matching current bucket.')
  })

  it('rejects malformed metric values and distinct traversals beyond the page budget', async () => {
    let malformed = true
    let page = 0
    const endpoint = await fixture(async (request, response) => {
      let text = ''; for await (const chunk of request) text += String(chunk)
      const body = JSON.parse(text) as { aggs: Record<string, unknown> }
      if (body.aggs.current) return response.end(JSON.stringify(elastic({
        source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') },
        current: malformed ? { doc_count: 3, m0: { value: 'three' } } : { doc_count: 3 },
      })))
      page++
      return response.end(JSON.stringify(elastic({ distinct: { buckets: [
        { key: { customer: `private-customer-${page}` } },
      ], after_key: { customer: `private-customer-${page}` } } })))
    })
    const sales = resolved({ metrics: ['sales_amount'], start: '2025-05-01', end: '2025-06-01', intent: 'summary' })
    await expect(executeSemanticAnalysis(reader(endpoint), sales.model, sales.plan, new AbortController().signal))
      .rejects.toThrow(/Invalid Elasticsearch metric value/)

    malformed = false
    const distinct = resolved({ metrics: ['purchaser_count'], start: '2025-05-01', end: '2025-06-01', intent: 'summary' })
    await expect(executeSemanticAnalysis(reader(endpoint, { distinctPageSize: 1, maxDistinctPages: 2 }),
      distinct.model, distinct.plan, new AbortController().signal)).rejects.toThrow(/distinct count exceeds page budget/)
  })

  it('rejects a source response that exceeds the requested terms bucket limit', async () => {
    const endpoint = await fixture((_request, response) => response.end(JSON.stringify(elastic({
      source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') },
      current: { doc_count: 3, d0: { sum_other_doc_count: 0, doc_count_error_upper_bound: 0, buckets: [
        { key: 'a', doc_count: 1, m0: { value: 1 } }, { key: 'b', doc_count: 1, m0: { value: 1 } },
        { key: 'c', doc_count: 1, m0: { value: 1 } },
      ] }, d0_missing: { doc_count: 0 } },
    }))))
    const { model, plan } = resolved({ metrics: ['sales_amount'], dimensions: ['channel'],
      start: '2025-05-01', end: '2025-06-01', intent: 'ranking' })

    await expect(executeSemanticAnalysis(reader(endpoint, { maxBuckets: 2 }), model, plan, new AbortController().signal))
      .rejects.toThrow(/bucket limit/)
  })

  it('enforces the byte limit on the complete result at and beyond the exact boundary', async () => {
    const endpoint = await fixture((_request, response) => response.end(JSON.stringify(elastic({
      source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') }, current: { doc_count: 3, m0: { value: 120 } },
    }))))
    const { model, plan } = resolved({ metrics: ['sales_amount'], start: '2025-05-01', end: '2025-06-01', intent: 'summary' })
    const first = await executeSemanticAnalysis(reader(endpoint), model, plan, new AbortController().signal)
    const bytes = Buffer.byteLength(JSON.stringify(first))
      + Buffer.byteLength(JSON.stringify({ version: 1, request: first.request, data: first }))

    await expect(executeSemanticAnalysis(reader(endpoint, { maxResponseBytes: bytes }), model, plan, new AbortController().signal))
      .resolves.toEqual(first)
    await expect(executeSemanticAnalysis(reader(endpoint, { maxResponseBytes: bytes - 1 }), model, plan, new AbortController().signal))
      .rejects.toThrow(/result byte limit exceeded/)
    const projection = semanticToolProjection(first)
    const projectionBytes = Buffer.byteLength(JSON.stringify(projection))
    expect(semanticToolProjectionBytes(first)).toBe(projectionBytes)
    expect(projection.content[0]?.text).toBe(JSON.stringify(first))
    expect(() => { assertSemanticToolProjectionSize(first, projectionBytes) }).not.toThrow()
    expect(() => { assertSemanticToolProjectionSize(first, projectionBytes - 1) }).toThrow(/tool projection byte limit exceeded/)
    const multibyte = structuredClone(first); multibyte.warnings.push('缺失')
    expect(semanticToolProjectionBytes(multibyte) - semanticToolProjectionBytes(first)).toBeGreaterThan('缺失'.length)
  })

  it('marks partial sum coverage and its derived ratio unavailable in grouped comparisons', async () => {
    const endpoint = await fixture((_request, response) => response.end(JSON.stringify(elastic({
      source_coverage: { value: Date.parse('2024-01-01T16:30:00Z') },
      current: { doc_count: 3, d0: { sum_other_doc_count: 0, doc_count_error_upper_bound: 0, buckets: [
        { key: 'online', doc_count: 2, m0: { value: 100 }, m0_missing: { doc_count: 1 }, m1: { value: 2 }, m1_missing: { doc_count: 1 } },
        { key: 'store', doc_count: 1, m0: { value: 0 }, m0_missing: { doc_count: 1 }, m1: { value: 1 }, m1_missing: { doc_count: 1 } },
      ] }, d0_missing: { doc_count: 0 } },
      comparison: { doc_count: 3, d0: { sum_other_doc_count: 0, doc_count_error_upper_bound: 0, buckets: [
        { key: 'online', doc_count: 2, m0: { value: 80 }, m0_missing: { doc_count: 0 }, m1: { value: 2 }, m1_missing: { doc_count: 0 } },
        { key: 'store', doc_count: 1, m0: { value: 40 }, m0_missing: { doc_count: 0 }, m1: { value: 1 }, m1_missing: { doc_count: 0 } },
      ] }, d0_missing: { doc_count: 0 } },
    }))))
    const { model, plan } = resolved({ metrics: ['sales_amount', 'atv'], dimensions: ['channel'],
      start: '2025-05-01', end: '2025-06-01', comparison: 'previous_period', intent: 'comparison' })
    const result = await executeSemanticAnalysis(reader(endpoint), model, plan, new AbortController().signal)
    expect(result.rows[0]?.metrics.sales_amount).toMatchObject({
      value: null, unavailableReason: '1 matching documents have missing sales_amount values',
    })
    expect(result.rows[0]?.metrics.atv).toMatchObject({ value: null, unavailableReason: 'sales_amount is unavailable' })
    expect(result.rows[1]?.metrics.sales_amount).toMatchObject({
      value: null, unavailableReason: '1 matching documents have missing sales_amount values',
    })
    expect(result.completeness).toMatchObject({ complete: false, missingMetricValues: 4 })
    expect(result.completeness.missingMetricValues).toBeGreaterThan(result.coverage.current.recordCount)
    expect(result.coverage.current.observedStart).toBe('2024-01-02')
  })

  it('compiles configured date filters as local-day ranges', async () => {
    let body: Record<string, unknown> = {}
    const endpoint = await fixture(async (request, response) => {
      let text = ''; for await (const chunk of request) text += String(chunk)
      body = JSON.parse(text) as Record<string, unknown>
      response.end(JSON.stringify(elastic({ source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') },
        current: { doc_count: 0, m0: { value: 0 }, m0_missing: { doc_count: 0 } } }, 0)))
    })
    const { model, plan } = resolved({ metrics: ['sales_amount'], start: '2025-05-01', end: '2025-06-01', intent: 'summary',
      filters: [{ dimension: 'day', operator: 'in', values: ['2025-05-01', '2025-05-03'] }] })
    await executeSemanticAnalysis(reader(endpoint), model, plan, new AbortController().signal)
    expect(body).toMatchObject({ query: { bool: { filter: [expect.anything(), { bool: { minimum_should_match: 1, should: [
      { range: { private_order_date: { gte: '2025-05-01T00:00:00+08:00', lt: '2025-05-02T00:00:00+08:00' } } },
      { range: { private_order_date: { gte: '2025-05-03T00:00:00+08:00', lt: '2025-05-04T00:00:00+08:00' } } },
    ] } }] } } })
  })

  it('compiles month drilldown parents for current and shifted comparison windows', async () => {
    type FilterBody = { aggs: { current: { filter: { bool: { filter: unknown[] } } }
      comparison: { filter: { bool: { filter: unknown[] } } } } }
    let body: FilterBody | undefined
    const endpoint = await fixture(async (request, response) => {
      let text = ''; for await (const chunk of request) text += String(chunk)
      body = JSON.parse(text) as FilterBody
      const month = (key: string) => ({ key_as_string: key, doc_count: 1,
        d1: { sum_other_doc_count: 0, doc_count_error_upper_bound: 0,
          buckets: [{ key: 'online', doc_count: 1, m0: { value: 10 }, m0_missing: { doc_count: 0 } }] },
        d1_missing: { doc_count: 0 } })
      response.end(JSON.stringify(elastic({ source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') },
        current: { doc_count: 1, d0: { buckets: [month('2025-05-01')] }, d0_missing: { doc_count: 0 } },
        comparison: { doc_count: 2, d0: { buckets: [month('2025-03-01'), month('2025-04-01')] }, d0_missing: { doc_count: 0 } } })))
    })
    const model = resolveSemanticModel(semanticConfig(), datasets)
    const request: DrilldownRequest = { metrics: ['sales_amount'], dimensions: ['day'], timeGrain: 'month',
      start: '2025-05-01', end: '2025-06-01', comparison: 'previous_period', intent: 'comparison',
      drilldownDimension: 'channel', parentFilters: [{ dimension: 'day', values: ['2025-05-01'] }] }
    const plan = resolveAnalysisPlan(model, request, { maxRangeDays: limits.maxRangeDays, maxBuckets: limits.maxBuckets })
    await executeSemanticAnalysis(reader(endpoint), model, plan, new AbortController().signal)
    expect(body?.aggs.current.filter.bool.filter[1]).toEqual({ range: { private_order_date: {
      gte: '2025-05-01T00:00:00+08:00', lt: '2025-06-01T00:00:00+08:00' } } })
    expect(body?.aggs.comparison.filter.bool.filter[1]).toEqual({ range: { private_order_date: {
      gte: '2025-03-01T00:00:00+08:00', lt: '2025-04-01T00:00:00+08:00' } } })
  })
})
