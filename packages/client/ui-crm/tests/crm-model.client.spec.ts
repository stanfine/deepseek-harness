import { describe, expect, it } from 'vitest'
import { readChart, drilldown } from '../src/client/model.ts'

const request = { dataset: 'orders', mode: 'group', dimension: 'channel', start: '2025-01-01', end: '2025-02-01', filters: [{ dimension: 'store', value: 'A' }] }
const data = { dataset: 'orders', start: request.start, end: request.end, timeZone: '+08:00', amountMeaning: 'Source amount', recordCount: 3, buckets: [{ key: 'pos', recordCount: 2, amount: { count: 2, sum: -10, avg: -5, min: -10, max: 0 } }], truncated: true, warning: 'Top terms only.' }
describe('CRM chart projection', () => {
  it('retains signed measures, source semantics and incomplete group disclosure', () => {
    expect(readChart({ crm: { version: 1, request, data } })).toMatchObject({ request, data })
  })
  it('rejects malformed, mismatched and unknown-version results without inventing values', () => {
    for (const meta of [undefined, {}, { crm: { version: 2, request, data } }, { crm: { version: 1, request, data: { ...data, dataset: 'members' } } }, { crm: { version: 1, request, data: { ...data, buckets: [{ key: 'x', recordCount: '2', amount: null }] } } }]) expect(readChart(meta)).toBeNull()
  })
  it('rejects unvalidated extra display fields even when another mode is selected', () => {
    const summary = { ...request, mode: 'summary' }
    for (const extra of [{ buckets: 'invalid' }, { customerCount: {} }, { amount: {} }, { warning: {} }]) {
      expect(readChart({ crm: { version: 1, request: summary, data: { ...data, amount: null, ...extra } } })).toBeNull()
    }
  })
  it('validates persisted analytical intent', () => {
    expect(readChart({ crm: { version: 1, request: { ...request, intent: 'composition' }, data } })?.request.intent).toBe('composition')
    expect(readChart({ crm: { version: 1, request: { ...request, intent: 'arbitrary' }, data } })).toBeNull()
  })
  it('preserves the date window and filters when preparing a drilldown', () => {
    expect(JSON.parse(drilldown(request, 'pos'))).toEqual({ dataset: 'orders', start: request.start, end: request.end, filters: [{ dimension: 'store', value: 'A' }, { dimension: 'channel', value: 'pos' }] })
  })
})
