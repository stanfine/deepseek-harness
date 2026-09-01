/** Validation of persisted CRM presentation metadata; absent measures stay absent. */
/** Supported JSON chart requests; arbitrary ECharts options never cross the wire. */
export const chartTypes = ['auto', 'bar', 'horizontal-bar', 'line', 'area', 'pie', 'donut', 'table'] as const
/** Analytical purposes used by automatic chart selection. */
export const intents = ['comparison', 'composition', 'ranking', 'trend'] as const
/** Measures available from bounded CRM aggregates. */
export const metrics = ['records', 'amount', 'average'] as const
/** A presentation choice, independent of data acquisition. */
export type ChartType = typeof chartTypes[number]
/** An existing numeric measure; no model-generated expressions. */
export type Metric = typeof metrics[number]
interface Request {
  dataset: string
  mode: string
  start: string
  end: string
  intent?: typeof intents[number]
  chartType?: ChartType
  metric?: Metric
  dimension?: string
  filters: Array<{ dimension: string; value: string }>
}
interface Amount { count: number; sum: number; avg: number | null; min: number | null; max: number | null }
interface Bucket { key: string | number; recordCount: number; amount: Amount | null }
interface Data {
  dataset: string
  start: string
  end: string
  timeZone: string
  amountMeaning: string
  recordCount?: number
  customerCount?: number
  missingCustomer?: number | null
  missingDimension?: number
  amount?: Amount | null
  buckets?: Bucket[]
  interval?: string
  truncated?: boolean
  warning?: string
}
/** Parsed metadata contains only display data and the allowed drilldown arguments. */
export interface Chart { request: Request; data: Data }

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function count(value: unknown): value is number { return finite(value) && Number.isSafeInteger(value) && value >= 0 }
function amount(value: unknown): value is Amount | null {
  return value === null || object(value) && count(value.count) && finite(value.sum)
    && [value.avg, value.min, value.max].every(v => v === null || finite(v))
}

/** Validate data received from session history before drawing a chart.
 * @param meta Persisted tool/result metadata.
 * @returns A supported CRM chart, or null for textual fallback.
 */
export function readChart(meta: unknown): Chart | null {
  if (!object(meta) || !object(meta.crm) || meta.crm.version !== 1) return null
  const { request, data } = meta.crm
  if (!object(request) || !object(data)) return null
  if (!['summary', 'group', 'customers', 'trend'].includes(String(request.mode))) return null
  if (!['dataset', 'start', 'end'].every(key => typeof request[key] === 'string' && request[key] === data[key])) return null
  if (typeof data.timeZone !== 'string' || typeof data.amountMeaning !== 'string') return null
  if (!Array.isArray(request.filters) || !request.filters.every(v => object(v) && typeof v.dimension === 'string' && typeof v.value === 'string')) return null
  if (data.warning !== undefined && typeof data.warning !== 'string') return null
  if (request.chartType !== undefined && !chartTypes.some(type => type === request.chartType)) return null
  if (request.intent !== undefined && !intents.some(intent => intent === request.intent)) return null
  if (request.metric !== undefined && !metrics.some(metric => metric === request.metric)) return null
  if (request.dimension !== undefined && typeof request.dimension !== 'string') return null
  if (data.truncated !== undefined && typeof data.truncated !== 'boolean') return null
  if (data.amount !== undefined && !amount(data.amount)) return null
  if (data.missingDimension !== undefined && !count(data.missingDimension)) return null
  if (data.recordCount !== undefined && !count(data.recordCount)) return null
  if (data.customerCount !== undefined && !count(data.customerCount)) return null
  if (data.missingCustomer !== undefined && data.missingCustomer !== null && !count(data.missingCustomer)) return null
  if (data.buckets !== undefined && (!Array.isArray(data.buckets) || !data.buckets.every(v => object(v)
    && (typeof v.key === 'string' || finite(v.key)) && count(v.recordCount) && amount(v.amount)))) return null
  if (request.mode === 'customers') {
    if (!count(data.customerCount) || !(data.missingCustomer === null || count(data.missingCustomer))) return null
  } else if (!count(data.recordCount)) return null
  if (request.mode === 'summary' && !amount(data.amount)) return null
  if (request.mode === 'group' || request.mode === 'trend') {
    if (!Array.isArray(data.buckets)) return null
    if (request.mode === 'group' && (typeof request.dimension !== 'string' || typeof data.truncated !== 'boolean')) return null
    if (request.mode === 'trend' && !['day', 'month'].includes(String(data.interval))) return null
  }
  return { request, data } as unknown as Chart
}

/** Encode a follow-up filter as data, preserving all unrelated filters.
 * @param request The chart's validated query request.
 * @param key Selected group value.
 * @returns JSON data to embed in a user-reviewed follow-up prompt.
 */
export function drilldown(request: Request, key: string | number): string {
  return JSON.stringify({ dataset: request.dataset, start: request.start, end: request.end,
    filters: [...request.filters.filter(filter => filter.dimension !== request.dimension),
      { dimension: request.dimension, value: String(key) }] })
}
