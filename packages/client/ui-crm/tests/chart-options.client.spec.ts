/** Rendering choices must preserve the meaning and completeness of source measures. */
import { expect, it } from 'vitest'
import { chooseView, chartOption } from '../src/client/chart-options.ts'
import type { Chart } from '../src/client/model.ts'
const chart: Chart = { request: { dataset: 'orders', mode: 'group', start: '2025-01-01', end: '2025-02-01', dimension: 'channel', filters: [] },
  data: { dataset: 'orders', start: '2025-01-01', end: '2025-02-01', timeZone: '+08:00', amountMeaning: 'Source', recordCount: 3, truncated: false, missingDimension: 0,
    buckets: [{ key: 'a', recordCount: 1, amount: { count: 1, sum: 10, avg: 10, min: 10, max: 10 } }, { key: 'b', recordCount: 2, amount: null }] } }
it('chooses temporal lines and categorical bars while honoring compatible explicit requests', () => {
  expect(chooseView(chart, 'auto', 'records').type).toBe('bar')
  expect(chooseView({ ...chart, request: { ...chart.request, mode: 'trend' } }, 'auto', 'records').type).toBe('line')
  expect(chooseView(chart, 'donut', 'records').type).toBe('donut')
})
it('refuses misleading proportions for negative, missing, partial or average values', () => {
  expect(chooseView(chart, 'pie', 'amount').adjusted).toBe(true)
  expect(chooseView(chart, 'pie', 'average').adjusted).toBe(true)
  expect(chooseView({ ...chart, data: { ...chart.data, truncated: true } }, 'pie', 'records').type).toBe('bar')
  expect(chooseView({ ...chart, data: { ...chart.data, recordCount: 9 } }, 'donut', 'records').adjusted).toBe(true)
})
it('builds ECharts options from canonical values and retains missing values as gaps', () => {
  const option = chartOption({ ...chart, request: { ...chart.request, mode: 'trend' } }, chooseView({ ...chart, request: { ...chart.request, mode: 'trend' } }, 'line', 'amount'), 'Source amount')
  expect(option.series).toMatchObject([{ type: 'line', connectNulls: false, data: [10, null] }])
  expect(option.tooltip).toMatchObject({ renderMode: 'richText' })
  expect(option.animation).toBe(false)
})

it('rejects overlapping groups whose duplicate membership hides missing records', () => {
  const overlapping: Chart = { ...chart, data: { ...chart.data, recordCount: 2, missingDimension: 1,
    buckets: [{ key: 'a', recordCount: 1, amount: null }, { key: 'b', recordCount: 1, amount: null }] } }
  expect(chooseView(overlapping, 'pie', 'records').adjusted).toBe(true)
})

it('selects charts by analytical intent and ranks the selected measure without mutating source buckets', () => {
  const composition: Chart = { ...chart, request: { ...chart.request, intent: 'composition' } }
  expect(chooseView(composition, 'auto', 'records').type).toBe('donut')
  expect(chooseView(composition, 'auto', 'average')).toMatchObject({ type: 'bar', adjusted: true })
  expect(chooseView({ ...composition, data: { ...composition.data, truncated: true } }, 'auto', 'records')).toMatchObject({ type: 'bar', adjusted: true })
  const ranking: Chart = { ...chart, request: { ...chart.request, intent: 'ranking' } }
  const view = chooseView(ranking, 'auto', 'records')
  expect(view.type).toBe('horizontal-bar')
  expect(view.points.map(point => point.key)).toEqual(['b', 'a'])
  expect(chart.data.buckets?.map(bucket => bucket.key)).toEqual(['a', 'b'])
})
it('does not connect unordered categories or imply a trend from a single time bucket', () => {
  expect(chooseView(chart, 'area', 'records')).toMatchObject({ type: 'bar', adjusted: true })
  const single: Chart = { ...chart, request: { ...chart.request, mode: 'trend' }, data: { ...chart.data, buckets: chart.data.buckets!.slice(0, 1) } }
  expect(chooseView(single, 'auto', 'records').type).toBe('table')
})
