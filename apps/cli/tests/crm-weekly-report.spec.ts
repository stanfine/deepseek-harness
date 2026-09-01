import { describe, expect, it } from 'vitest'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { resolveReportPeriods } from '../config/examples/crm/report-periods.ts'
import { WeeklyReportReader, type WeeklyReportConfig } from '../config/examples/crm/weekly-report.ts'

const config: WeeklyReportConfig = {
  timeZone: '+08:00', timeoutMs: 1000, maxBuckets: 10, distinctPageSize: 10, maxDistinctPages: 2,
  fiscalYearStartMonth: 4,
  lifecycleHistoryCompleteFrom: '2023-01-01', weeklyMultipleOrdersAreRepeatPurchasers: true,
  orderFacts: { dataset: 'order_facts', timeField: 'orderDate', customerField: 'customerId', amountField: 'orderAmount',
    orderCountField: 'orderCount', quantityField: 'skuQuantity' },
  orderItems: { dataset: 'order_items', timeField: 'time', amountField: 'amount', quantityField: 'quantity',
    seriesField: 'series', skuField: 'sku' },
}

function complete(aggregations: JsonValue): JsonValue {
  return { timed_out: false, _shards: { failed: 0 }, hits: { total: { value: 3, relation: 'eq' }, hits: [] }, aggregations }
}

describe('CRM weekly report reader', () => {
  it('computes additive sales and exact bounded customer ratios without exposing keys', async () => {
    const bodies: JsonValue[] = []
    const reader = new WeeklyReportReader(config, async (_dataset, body) => {
      bodies.push(body)
      const aggs = body as { aggs?: Record<string, unknown> }
      if (aggs.aggs?.earliest) return complete({
        earliest: { value: Date.parse('2024-01-01T00:00:00Z'), value_as_string: '2024-01-01T00:00:00.000Z' },
        latest: { value: Date.parse('2025-12-31T00:00:00Z'), value_as_string: '2025-12-31T00:00:00.000Z' },
        missingTime: { doc_count: 0 },
      })
      return complete({
        amount: { value: 1200 }, orders: { value: 4 }, quantity: { value: 6 },
        customers: { buckets: [
          { key: { customer: 'customer-a' }, orderCount: { value: 2 } },
          { key: { customer: 'customer-b' }, orderCount: { value: 1 } },
          { key: { customer: 'customer-c' }, orderCount: { value: 1 } },
        ] }, missingCustomer: { doc_count: 0 },
      })
    })
    const periods = resolveReportPeriods('2025-05-07', '+08:00', 4, '2025-05-20')
    const report = await reader.sales(periods, new AbortController().signal)
    expect(report.rows[0]).toMatchObject({
      period: 'current', amount: 1200, orders: 4, purchasers: 3, repeatPurchasers: 1, quantity: 6,
      amountPerOrder: { value: 300 }, itemsPerOrder: { value: 1.5 }, amountPerItem: { value: 200 },
      frequency: { value: 4 / 3 }, amountPerPurchaser: { value: 400 }, exactCustomers: true,
    })
    expect(report.rows).toHaveLength(4)
    expect(JSON.stringify(report)).not.toMatch(/customer-a|password|_search/)
    expect(bodies).toHaveLength(5)
  })

  it('returns null ratios with reasons instead of division errors', async () => {
    const reader = new WeeklyReportReader(config, async (_dataset, body) => {
      const aggs = body as { aggs?: Record<string, unknown> }
      if (aggs.aggs?.earliest) return complete({ earliest: { value: Date.parse('2024-01-01T00:00:00Z') },
        latest: { value: Date.parse('2025-12-31T00:00:00Z') }, missingTime: { doc_count: 0 } })
      return complete({ amount: { value: 0 }, orders: { value: 0 }, quantity: { value: 0 },
        customers: { buckets: [] }, missingCustomer: { doc_count: 0 } })
    })
    const report = await reader.sales(resolveReportPeriods('2025-05-07', '+08:00', 4, '2025-05-20'), new AbortController().signal)
    expect(report.rows[0]).toMatchObject({
      amountPerOrder: { value: null, reason: 'order count is zero' },
      amountPerPurchaser: { value: null, reason: 'purchaser count is zero' },
    })
  })

  it('classifies exact lifecycle cohorts across pages without returning customer keys', async () => {
    let customerPage = 0
    const reader = new WeeklyReportReader(config, async (_dataset, body) => {
      const aggs = body as { aggs?: Record<string, unknown> }
      if (aggs.aggs?.earliest) return complete({ earliest: { value: Date.parse('2023-01-01T00:00:00Z') },
        latest: { value: Date.parse('2025-12-31T00:00:00Z') }, missingTime: { doc_count: 0 } })
      const bucket = (key: string, first: string, current: number, priorFiscal: number, earlier: number) => ({
        key: { customer: key }, firstPurchase: { value: Date.parse(`${first}T00:00:00Z`) },
        current: { doc_count: current }, priorFiscal: { doc_count: priorFiscal }, earlier: { doc_count: earlier },
      })
      return complete({ customers: customerPage++ === 0 ? { buckets: [
        bucket('new-customer', '2025-05-06', 1, 0, 0),
        bucket('existing-active', '2025-04-02', 1, 0, 0),
        bucket('existing-inactive', '2025-04-03', 0, 0, 0),
      ], after_key: { customer: 'existing-inactive' } } : { buckets: [
        bucket('retained-active', '2024-06-01', 1, 1, 0),
        bucket('retained-inactive', '2024-06-02', 0, 1, 0),
        bucket('winback-active', '2023-06-01', 1, 0, 1),
      ] } })
    })
    const report = await reader.lifecycle(resolveReportPeriods('2025-05-07', '+08:00', 4, '2025-05-20'), new AbortController().signal)
    expect(report).toMatchObject({ available: true, exact: true, newPurchasers: 1,
      existingNew: { base: 2, active: 1, rate: { value: 0.5 } },
      retained: { base: 2, active: 1, rate: { value: 0.5 } },
      winback: { base: 1, active: 1, rate: { value: 1 } },
    })
    expect(JSON.stringify(report)).not.toMatch(/new-customer|retained-active|winback-active/)
  })

  it('refuses lifecycle metrics when history does not cover the prior fiscal year', async () => {
    const reader = new WeeklyReportReader(config, async () => complete({
      earliest: { value: Date.parse('2024-12-01T00:00:00Z') }, latest: { value: Date.parse('2025-12-31T00:00:00Z') },
      missingTime: { doc_count: 0 },
    }))
    await expect(reader.lifecycle(resolveReportPeriods('2025-05-07', '+08:00', 4, '2025-05-20'), new AbortController().signal))
      .resolves.toMatchObject({ available: false, requiredStart: '2024-04-01', observedStart: '2024-12-01' })
  })

  it('refuses lifecycle metrics without an owner-declared complete-history date', async () => {
    const { lifecycleHistoryCompleteFrom: _history, ...withoutHistory } = config
    const reader = new WeeklyReportReader(withoutHistory, async () => complete({
      earliest: { value: Date.parse('2023-01-01T00:00:00Z') }, latest: { value: Date.parse('2025-12-31T00:00:00Z') },
      missingTime: { doc_count: 0 },
    }))
    await expect(reader.lifecycle(resolveReportPeriods('2025-05-07', '+08:00', 4, '2025-05-20'), new AbortController().signal))
      .resolves.toMatchObject({ available: false, requiredStart: '2024-04-01' })
  })

  it('reports bounded product contribution from line-item fields without calling rows orders or UV', async () => {
    const reader = new WeeklyReportReader(config, async (_dataset, body) => {
      const aggs = body as { aggs?: Record<string, unknown> }
      if (aggs.aggs?.earliest) return complete({ earliest: { value: Date.parse('2024-01-01T00:00:00Z') },
        latest: { value: Date.parse('2025-12-31T00:00:00Z') }, missingTime: { doc_count: 0 } })
      return complete({ groups: { sum_other_doc_count: 1, doc_count_error_upper_bound: 0, buckets: [{
        key: 'CLUB', doc_count: 2,
        current: { doc_count: 2, amount: { value: 100 }, quantity: { value: 3 } },
        previous: { doc_count: 1, amount: { value: 80 }, quantity: { value: 2 } },
        priorYear: { doc_count: 1, amount: { value: -10 }, quantity: { value: 1 } },
      }] }, missingKey: { doc_count: 1 } })
    })
    const report = await reader.products(resolveReportPeriods('2025-05-07', '+08:00', 4, '2025-05-20'), 'series', new AbortController().signal)
    expect(report).toMatchObject({ available: true, truncated: true, omitted: 1, missingKey: 1, groups: [{
      key: 'CLUB', lineDocumentCount: 2,
      current: { amount: 100, quantity: 3 }, previous: { amount: 80, quantity: 2 }, priorYear: { amount: -10, quantity: 1 },
    }] })
    expect(JSON.stringify(report)).not.toMatch(/customer|"orders"|"UV"/)
  })

  it('marks a product dimension unavailable when all current rows lack its key', async () => {
    const reader = new WeeklyReportReader(config, async (_dataset, body) => {
      const aggs = body as { aggs?: Record<string, unknown> }
      if (aggs.aggs?.earliest) return complete({ earliest: { value: Date.parse('2024-01-01T00:00:00Z') },
        latest: { value: Date.parse('2025-12-31T00:00:00Z') }, missingTime: { doc_count: 0 } })
      return complete({ groups: { sum_other_doc_count: 0, doc_count_error_upper_bound: 0, buckets: [] }, missingKey: { doc_count: 3 } })
    })
    await expect(reader.products(resolveReportPeriods('2025-05-07', '+08:00', 4, '2025-05-20'), 'series', new AbortController().signal))
      .resolves.toMatchObject({ available: false, groupBy: 'series', reason: 'Configured series field has no values in the report query.' })
  })
})
