/** Validation and display types for persisted flexible CRM analysis results. */
export type AnalysisIntent = 'summary' | 'trend' | 'ranking' | 'composition' | 'comparison'
/** A closed metric format supplied by the semantic catalog. */
export type AnalysisMetricFormat = 'currency' | 'number' | 'decimal'
/** One selected dimension column. */
export interface AnalysisDimensionColumn { id: string; name: string; dataType: 'date' | 'keyword' }
/** One selected metric column. */
export interface AnalysisMetricColumn { id: string; name: string; format: AnalysisMetricFormat; description: string; limitations: string[] }
/** Persisted current and optional comparison values; the client never derives them. */
export interface AnalysisMetricValue {
  value: number | null
  comparisonValue?: number | null
  changeRatio?: number | null
  unavailableReason?: string
  comparisonUnavailableReason?: string
  changeUnavailableReason?: string
}
/** One aggregate row keyed only by declared column ids. */
export interface AnalysisReportRow {
  dimensions: Record<string, string | number>
  metrics: Record<string, AnalysisMetricValue>
}
/** The normalized request persisted with an analysis result. */
export interface AnalysisReportRequest {
  metrics: string[]
  dimensions: string[]
  filters: Array<{ dimension: string; operator: 'equals' | 'in'; values: string[] }>
  start: string
  end: string
  intent: AnalysisIntent
  comparison?: 'previous_period' | 'prior_year'
  timeGrain?: 'day' | 'week' | 'month'
  sort?: { metric: string; direction: 'asc' | 'desc' }
  limit: number
}
/** Validated persisted semantic result used by CRM presentation code. */
export interface AnalysisReport {
  request: AnalysisReportRequest
  columns: { dimensions: AnalysisDimensionColumn[]; metrics: AnalysisMetricColumn[] }
  rows: AnalysisReportRow[]
  coverage: {
    current: { start: string; end: string; recordCount: number; available: true; observedStart: string | null }
    comparison?: {
      kind: 'previous_period' | 'prior_year'
      start: string
      end: string
      recordCount: number
      available: boolean
      observedStart: string | null
      reason?: string
    }
  }
  completeness: {
    complete: boolean
    missingDimensionDocuments: number
    omittedDocuments: number
    limitedRows: number
    countErrorUpperBound: number
    approximateMetrics: string[]
  }
  warnings: string[]
  drilldownDimensions: string[]
}

const MAX_ROWS = 500
const MAX_TEXT = 2000
const MAX_LIST = 100
const ID = /^[a-z][a-z0-9_]{0,63}$/

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function count(value: unknown): value is number { return finite(value) && Number.isSafeInteger(value) && value >= 0 }
function text(value: unknown): value is string { return typeof value === 'string' && value.length <= MAX_TEXT }
function id(value: unknown): value is string { return typeof value === 'string' && ID.test(value) }
function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
function unique(values: readonly string[]): boolean { return new Set(values).size === values.length }
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}
function sameKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key))
}
function stringList(value: unknown, limit = MAX_LIST): value is string[] {
  return Array.isArray(value) && value.length <= limit && value.every(text)
}
function idList(value: unknown, limit: number): value is string[] {
  return Array.isArray(value) && value.length <= limit && value.every(id) && unique(value)
}

function request(value: unknown): value is AnalysisReportRequest {
  if (!object(value) || !exactKeys(value, ['metrics', 'dimensions', 'filters', 'start', 'end', 'intent', 'comparison', 'timeGrain', 'sort', 'limit'])
    || !idList(value.metrics, 5) || value.metrics.length === 0 || !idList(value.dimensions, 2)
    || !Array.isArray(value.filters) || value.filters.length > 20 || !date(value.start) || !date(value.end) || value.start >= value.end
    || !['summary', 'trend', 'ranking', 'composition', 'comparison'].includes(String(value.intent)) || !count(value.limit) || value.limit === 0 || value.limit > MAX_ROWS) return false
  if (value.comparison !== undefined
    && (typeof value.comparison !== 'string' || !['previous_period', 'prior_year'].includes(value.comparison))) return false
  if (value.timeGrain !== undefined
    && (typeof value.timeGrain !== 'string' || !['day', 'week', 'month'].includes(value.timeGrain))) return false
  if (value.sort !== undefined && (!object(value.sort) || !exactKeys(value.sort, ['metric', 'direction'])
    || !id(value.sort.metric) || !value.metrics.includes(value.sort.metric) || !['asc', 'desc'].includes(String(value.sort.direction)))) return false
  return value.filters.every(filter => object(filter) && exactKeys(filter, ['dimension', 'operator', 'values']) && id(filter.dimension)
    && ['equals', 'in'].includes(String(filter.operator)) && stringList(filter.values, 50) && filter.values.length > 0)
}

function dimensionColumn(value: unknown): value is AnalysisDimensionColumn {
  return object(value) && exactKeys(value, ['id', 'name', 'dataType']) && id(value.id) && text(value.name)
    && ['date', 'keyword'].includes(String(value.dataType))
}
function metricColumn(value: unknown): value is AnalysisMetricColumn {
  return object(value) && exactKeys(value, ['id', 'name', 'format', 'description', 'limitations']) && id(value.id) && text(value.name)
    && ['currency', 'number', 'decimal'].includes(String(value.format)) && text(value.description) && stringList(value.limitations, 20)
}
function columns(value: unknown, selected: AnalysisReportRequest): value is AnalysisReport['columns'] {
  if (!object(value) || !exactKeys(value, ['dimensions', 'metrics']) || !Array.isArray(value.dimensions) || !Array.isArray(value.metrics)
    || !value.dimensions.every(dimensionColumn) || !value.metrics.every(metricColumn)) return false
  const dimensions = value.dimensions.map(column => column.id)
  const metrics = value.metrics.map(column => column.id)
  return unique(dimensions) && unique(metrics) && JSON.stringify(dimensions) === JSON.stringify(selected.dimensions)
    && JSON.stringify(metrics) === JSON.stringify(selected.metrics)
}

const METRIC_VALUE_KEYS = ['value', 'comparisonValue', 'changeRatio', 'unavailableReason', 'comparisonUnavailableReason', 'changeUnavailableReason']
function metricValue(value: unknown, compared: boolean): value is AnalysisMetricValue {
  if (!object(value) || !exactKeys(value, METRIC_VALUE_KEYS) || !(value.value === null || finite(value.value))) return false
  for (const key of ['comparisonValue', 'changeRatio'] as const) if (value[key] !== undefined && value[key] !== null && !finite(value[key])) return false
  for (const key of ['unavailableReason', 'comparisonUnavailableReason', 'changeUnavailableReason'] as const) if (value[key] !== undefined && !text(value[key])) return false
  if ((value.value === null) !== (value.unavailableReason !== undefined)) return false
  if (!compared) return value.comparisonValue === undefined && value.changeRatio === undefined
    && value.comparisonUnavailableReason === undefined && value.changeUnavailableReason === undefined
  return Object.hasOwn(value, 'comparisonValue') && Object.hasOwn(value, 'changeRatio')
    && (value.comparisonValue === null) === (value.comparisonUnavailableReason !== undefined)
    && (value.changeRatio === null) === (value.changeUnavailableReason !== undefined)
}
function row(value: unknown, selected: AnalysisReportRequest, declared: AnalysisReport['columns']): value is AnalysisReportRow {
  if (!object(value) || !exactKeys(value, ['dimensions', 'metrics']) || !object(value.dimensions) || !object(value.metrics)
    || !sameKeys(value.dimensions, selected.dimensions) || !sameKeys(value.metrics, selected.metrics)) return false
  const dimensions = value.dimensions
  const metrics = value.metrics
  return declared.dimensions.every(column => column.dataType === 'date' ? date(dimensions[column.id])
    : typeof dimensions[column.id] === 'string' ? text(dimensions[column.id]) : finite(dimensions[column.id]))
    && Object.values(metrics).every(item => metricValue(item, selected.comparison !== undefined))
}

function window(value: unknown, current: boolean): boolean {
  return object(value) && exactKeys(value, current ? ['start', 'end', 'recordCount', 'available', 'observedStart']
    : ['kind', 'start', 'end', 'recordCount', 'available', 'observedStart', 'reason'])
    && date(value.start) && date(value.end) && value.start < value.end && count(value.recordCount) && typeof value.available === 'boolean'
    && (value.observedStart === null || date(value.observedStart)) && (value.reason === undefined || text(value.reason))
}
function coverage(value: unknown, selected: AnalysisReportRequest): value is AnalysisReport['coverage'] {
  if (!object(value) || !exactKeys(value, ['current', 'comparison']) || !window(value.current, true) || !object(value.current)
    || value.current.available !== true || value.current.start !== selected.start || value.current.end !== selected.end) return false
  if (selected.comparison === undefined) return value.comparison === undefined
  return window(value.comparison, false) && object(value.comparison) && value.comparison.kind === selected.comparison
    && (value.comparison.available === true ? value.comparison.reason === undefined : text(value.comparison.reason))
}
function completeness(value: unknown, metrics: readonly string[]): value is AnalysisReport['completeness'] {
  if (!object(value) || !exactKeys(value, ['complete', 'missingDimensionDocuments', 'omittedDocuments', 'limitedRows', 'countErrorUpperBound', 'approximateMetrics'])
    || typeof value.complete !== 'boolean' || !count(value.missingDimensionDocuments) || !count(value.omittedDocuments)
    || !count(value.limitedRows) || !count(value.countErrorUpperBound) || !idList(value.approximateMetrics, 5)
    || !value.approximateMetrics.every(metric => metrics.includes(metric))) return false
  return !value.complete || value.missingDimensionDocuments === 0 && value.omittedDocuments === 0 && value.limitedRows === 0
    && value.countErrorUpperBound === 0 && value.approximateMetrics.length === 0
}
function sameRequest(left: AnalysisReportRequest, right: AnalysisReportRequest): boolean {
  return left.start === right.start && left.end === right.end && left.intent === right.intent && left.comparison === right.comparison
    && left.timeGrain === right.timeGrain && left.limit === right.limit
    && JSON.stringify(left.metrics) === JSON.stringify(right.metrics)
    && JSON.stringify(left.dimensions) === JSON.stringify(right.dimensions)
    && JSON.stringify(left.filters) === JSON.stringify(right.filters)
    && JSON.stringify(left.sort) === JSON.stringify(right.sort)
}

/** Validate flexible CRM analysis metadata before rendering.
 * @param meta Persisted tool result metadata.
 * @returns Closed analysis data, or null for textual fallback.
 */
export function readAnalysis(meta: unknown): AnalysisReport | null {
  if (!object(meta) || !object(meta.crmAnalysis) || !exactKeys(meta.crmAnalysis, ['version', 'request', 'data'])
    || meta.crmAnalysis.version !== 1 || !request(meta.crmAnalysis.request) || !object(meta.crmAnalysis.data)) return null
  const outerRequest = meta.crmAnalysis.request
  const data = meta.crmAnalysis.data
  if (!exactKeys(data, ['version', 'request', 'columns', 'rows', 'coverage', 'completeness', 'warnings', 'drilldownDimensions'])
    || data.version !== 1 || !request(data.request) || !sameRequest(outerRequest, data.request)) return null
  if (!columns(data.columns, outerRequest)) return null
  const declared = data.columns
  if (!Array.isArray(data.rows) || data.rows.length > MAX_ROWS
    || !data.rows.every(item => row(item, outerRequest, declared)) || !coverage(data.coverage, outerRequest)
    || !completeness(data.completeness, outerRequest.metrics) || !stringList(data.warnings)
    || !idList(data.drilldownDimensions, 100) || data.drilldownDimensions.some(id => outerRequest.dimensions.includes(id))) return null
  return { request: outerRequest, columns: data.columns, rows: data.rows, coverage: data.coverage,
    completeness: data.completeness, warnings: data.warnings, drilldownDimensions: data.drilldownDimensions }
}
