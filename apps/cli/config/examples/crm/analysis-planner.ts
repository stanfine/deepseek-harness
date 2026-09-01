/** Resolve closed CRM aggregate requests into executor-only semantic plans. */
import { calendarBucketCount, calendarRangeDays, resolveCalendarRange, shiftCalendarRange } from './report-periods.ts'
import type {
  DimensionDefinition,
  DimensionFilter,
  MetricDefinition,
  RatioMetricDefinition,
  ResolvedSemanticModel,
} from './semantic-model.ts'

/** Comparison window requested alongside the current calendar range. */
export type Comparison = 'none' | 'previous_period' | 'prior_year'
/** Date histogram granularity accepted by a configured date dimension. */
export type TimeGrain = 'day' | 'week' | 'month'
/** Presentation purpose that constrains the result without exposing query syntax. */
export type AnalysisIntent = 'summary' | 'trend' | 'ranking' | 'composition' | 'comparison'
/** One equality filter using a configured dimension id. */
export interface EqualityFilter {
  dimension: string
  operator: 'equals'
  value: string
}
/** One inclusion filter using a configured dimension id. */
export interface InclusionFilter {
  dimension: string
  operator: 'in'
  values: readonly string[]
}
/** Closed filter accepted by a semantic analysis request. */
export type AnalysisFilter = EqualityFilter | InclusionFilter
/** Requested metric sort order for a bounded grouped result. */
export interface AnalysisSort {
  metric: string
  direction: 'asc' | 'desc'
}
/** Closed aggregate analysis request without physical source names or expressions. */
export interface AnalysisRequest {
  metrics: readonly string[]
  start: string
  end: string
  intent: AnalysisIntent
  dimensions?: readonly string[]
  filters?: readonly AnalysisFilter[]
  comparison?: Comparison
  timeGrain?: TimeGrain
  sort?: AnalysisSort
  limit?: number
}
/** A selected parent bucket used to constrain a bounded follow-up analysis. */
export interface DrilldownParentFilter {
  dimension: string
  values: readonly string[]
}
/** Aggregate analysis with one new dimension and selected parent bucket values. */
export interface DrilldownRequest extends AnalysisRequest {
  drilldownDimension: string
  parentFilters: readonly DrilldownParentFilter[]
}
/** Reader limits needed to reject unsafe requests before execution. */
export interface AnalysisBudgets {
  maxRangeDays: number
  maxBuckets: number
}
/** A resolved allowlisted filter with normalized scalar values. */
export interface ResolvedAnalysisFilter {
  dimension: DimensionDefinition
  operator: DimensionFilter
  values: readonly string[]
}
/** Metric order used after source aggregations have completed. */
export type DerivedMetric = RatioMetricDefinition
/** Fully validated one-dataset instruction for the semantic executor. */
export interface ResolvedAnalysisPlan {
  dataset: string
  start: string
  end: string
  metrics: readonly MetricDefinition[]
  sourceMeasures: readonly Exclude<MetricDefinition, RatioMetricDefinition | { kind: 'unavailable' }>[]
  derivedMetrics: readonly DerivedMetric[]
  dimensions: readonly DimensionDefinition[]
  filters: readonly ResolvedAnalysisFilter[]
  comparison?: { kind: Exclude<Comparison, 'none'>; start: string; end: string }
  timeGrain?: TimeGrain
  sort?: AnalysisSort
  limit: number
  intent: AnalysisIntent
}

const intents = new Set<AnalysisIntent>(['summary', 'trend', 'ranking', 'composition', 'comparison'])
const comparisons = new Set<Comparison>(['none', 'previous_period', 'prior_year'])
const timeGrains = new Set<TimeGrain>(['day', 'week', 'month'])
const requestKeys = new Set(['metrics', 'dimensions', 'start', 'end', 'intent', 'filters', 'comparison', 'timeGrain', 'sort', 'limit',
  'drilldownDimension', 'parentFilters'])
const filterKeys = new Set(['dimension', 'operator', 'value', 'values'])
const parentFilterKeys = new Set(['dimension', 'values'])
const sortKeys = new Set(['metric', 'direction'])

function plainObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function closedKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, message: string): void {
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error(message)
}

function boundedStrings(value: unknown, maxChars: number): void {
  if (typeof value === 'string') {
    if (value.length === 0 || value.length > maxChars) throw new Error('Analysis text exceeds limit')
    return
  }
  if (Array.isArray(value)) { for (const item of value) boundedStrings(item, maxChars); return }
  if (value && typeof value === 'object') for (const item of Object.values(value)) boundedStrings(item, maxChars)
}

function validateRequestEnvelope(model: ResolvedSemanticModel, request: unknown): asserts request is AnalysisRequest | DrilldownRequest {
  const input = plainObject(request, 'Invalid analysis request')
  closedKeys(input, requestKeys, 'Unknown analysis argument')
  const serialized = JSON.stringify(input)
  if (new TextEncoder().encode(serialized).byteLength > model.limits.maxRequestBytes) throw new Error('Analysis request exceeds byte limit')
  boundedStrings(input, model.limits.maxInputChars)
  if (input.filters !== undefined) {
    if (!Array.isArray(input.filters)) throw new Error('Invalid filters')
    for (const item of input.filters) {
      const filter = plainObject(item, 'Invalid filter')
      closedKeys(filter, filterKeys, 'Unknown filter argument')
      if (Array.isArray(filter.values) && filter.values.length > model.limits.maxFilterValues) throw new Error('Too many inclusion values')
    }
  }
  if (input.parentFilters !== undefined) {
    if (!Array.isArray(input.parentFilters)) throw new Error('Invalid drilldown parent filters')
    for (const item of input.parentFilters) {
      const filter = plainObject(item, 'Invalid drilldown parent filter')
      closedKeys(filter, parentFilterKeys, 'Unknown drilldown parent argument')
      if (Array.isArray(filter.values) && filter.values.length > model.limits.maxFilterValues) throw new Error('Too many parent values')
    }
  }
  if (input.sort !== undefined) closedKeys(plainObject(input.sort, 'Invalid sort'), sortKeys, 'Unknown sort argument')
}

function unique(values: readonly string[]): string[] {
  const result: string[] = []
  for (const value of values) if (!result.includes(value)) result.push(value)
  return result
}

function requireText(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
  return value
}

function requireMetric(model: ResolvedSemanticModel, id: unknown): MetricDefinition {
  const metric = model.metrics.get(requireText(id, 'Unknown metric'))
  if (!metric) throw new Error(`Unknown metric ${String(id)}`)
  if (metric.kind === 'unavailable') throw new Error(`Metric unavailable ${metric.id}`)
  return metric
}

function requireDimension(model: ResolvedSemanticModel, id: unknown): DimensionDefinition {
  const dimension = model.dimensions.get(requireText(id, 'Unknown dimension'))
  if (!dimension) throw new Error(`Unknown dimension ${String(id)}`)
  return dimension
}

function sameDataset(dataset: string, definition: { dataset: string }, subject: string): void {
  if (definition.dataset !== dataset) throw new Error(`Cross-dataset selection: ${subject} belongs to ${definition.dataset}`)
}

function resolveValues(values: unknown, message: string): string[] {
  if (!Array.isArray(values) || values.length === 0) throw new Error(message)
  return unique(values.map(value => requireText(value, message)))
}

function resolveFilter(model: ResolvedSemanticModel, dataset: string, filter: unknown): ResolvedAnalysisFilter {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) throw new Error('Invalid filter')
  const input = filter as { dimension?: unknown; operator?: unknown; value?: unknown; values?: unknown }
  const dimension = requireDimension(model, input.dimension)
  sameDataset(dataset, dimension, `dimension ${dimension.id}`)
  if ((input.operator !== 'equals' && input.operator !== 'in') || !dimension.filters.includes(input.operator)) {
    throw new Error(`Unsupported filter for dimension ${dimension.id}`)
  }
  const values = input.operator === 'equals'
    ? resolveValues([input.value], 'Equality filter requires one text value')
    : resolveValues(input.values, 'Inclusion filter requires text values')
  return { dimension, operator: input.operator, values: Object.freeze(values) }
}

function resolveDimensions(model: ResolvedSemanticModel, dataset: string, ids: unknown): DimensionDefinition[] {
  if (ids === undefined) return []
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('Invalid dimensions')
  const result = unique(ids).map(id => requireDimension(model, id))
  if (result.length > model.limits.maxDimensions) throw new Error('Too many dimensions')
  for (const dimension of result) sameDataset(dataset, dimension, `dimension ${dimension.id}`)
  return result
}

function resolveMetrics(model: ResolvedSemanticModel, ids: unknown): MetricDefinition[] {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error(`Select one to ${model.limits.maxSelectedMetrics} metrics`)
  const result = unique(ids).map(id => requireMetric(model, id))
  if (result.length === 0 || result.length > model.limits.maxSelectedMetrics) throw new Error(`Select one to ${model.limits.maxSelectedMetrics} metrics`)
  const dataset = result[0]!.dataset
  for (const metric of result) sameDataset(dataset, metric, `metric ${metric.id}`)
  return result
}

function resolveDerivedMetricOrder(model: ResolvedSemanticModel, metrics: readonly MetricDefinition[]): Pick<ResolvedAnalysisPlan, 'sourceMeasures' | 'derivedMetrics'> {
  const sources: Exclude<MetricDefinition, RatioMetricDefinition | { kind: 'unavailable' }>[] = []
  const derived: RatioMetricDefinition[] = []
  const visited = new Set<string>()
  const visit = (metric: MetricDefinition): void => {
    if (visited.has(metric.id)) return
    visited.add(metric.id)
    if (metric.kind === 'ratio') {
      for (const dependency of metric.dependencies) visit(requireMetric(model, dependency))
      derived.push(metric)
    } else if (metric.kind === 'sum' || metric.kind === 'count' || metric.kind === 'distinct_count') sources.push(metric)
    else throw new Error(`Metric unavailable ${metric.id}`)
  }
  for (const metric of metrics) visit(metric)
  return { sourceMeasures: Object.freeze(sources), derivedMetrics: Object.freeze(derived) }
}

function resolveTimeGrain(
  model: ResolvedSemanticModel, dimensions: readonly DimensionDefinition[], grain: unknown, intent: AnalysisIntent,
): TimeGrain | undefined {
  if (grain === undefined) {
    if (intent === 'trend') throw new Error('Trend requires a time grain')
    return undefined
  }
  if (typeof grain !== 'string' || !timeGrains.has(grain as TimeGrain) || !model.limits.timeGrains.includes(grain as TimeGrain)) {
    throw new Error('Unsupported time grain')
  }
  const dimension = dimensions.find(candidate => candidate.dataType === 'date' && candidate.timeGrains?.includes(grain as TimeGrain))
  if (!dimension) throw new Error('Time grain requires one configured date dimension')
  return grain as TimeGrain
}

function resolveSort(sort: unknown, metrics: readonly MetricDefinition[]): AnalysisSort | undefined {
  if (sort === undefined) return undefined
  if (!sort || typeof sort !== 'object' || Array.isArray(sort)) throw new Error('Invalid sort')
  const input = sort as Partial<AnalysisSort>
  if (!metrics.some(metric => metric.id === input.metric)) throw new Error('Sort metric must be selected')
  if (input.direction !== 'asc' && input.direction !== 'desc') throw new Error('Invalid sort direction')
  return { metric: input.metric!, direction: input.direction }
}

function isDrilldownRequest(request: AnalysisRequest | DrilldownRequest): request is DrilldownRequest {
  return 'drilldownDimension' in request || 'parentFilters' in request
}

/** Resolve a closed analysis or drilldown request before the executor accesses a source.
 * @param model Validated semantic catalog.
 * @param request Model-facing aggregate request.
 * @param budgets Reader range and bucket limits.
 * @returns One-dataset plan containing only configured metrics, dimensions, and filters.
 * @throws {Error} When the request exceeds configured limits or names incompatible concepts.
 */
export function resolveAnalysisPlan(
  model: ResolvedSemanticModel, request: AnalysisRequest | DrilldownRequest, budgets: AnalysisBudgets,
): ResolvedAnalysisPlan {
  validateRequestEnvelope(model, request)
  if (!Number.isSafeInteger(budgets.maxBuckets) || budgets.maxBuckets <= 0) throw new Error('Invalid bucket budget')
  if (!intents.has(request.intent)) throw new Error('Unknown analysis intent')
  const metrics = resolveMetrics(model, request.metrics)
  const dataset = metrics[0]!.dataset
  const range = resolveCalendarRange(request.start, request.end, budgets.maxRangeDays)
  const dimensions = resolveDimensions(model, dataset, request.dimensions)
  if (!Array.isArray(request.filters) && request.filters !== undefined) throw new Error('Invalid filters')
  const filters = (request.filters ?? []).map(filter => resolveFilter(model, dataset, filter))
  if (filters.length > model.limits.maxFilters) throw new Error('Too many filters')
  if (!comparisons.has(request.comparison ?? 'none')) throw new Error('Unknown comparison')
  const comparisonKind = request.comparison
  const comparison = comparisonKind === undefined || comparisonKind === 'none' ? undefined : {
    kind: comparisonKind,
    ...shiftCalendarRange(range, comparisonKind === 'previous_period' ? -calendarRangeDays(range) : -364),
  }
  if (isDrilldownRequest(request)) {
    const drilldown = requireDimension(model, request.drilldownDimension)
    if (dimensions.some(dimension => dimension.id === drilldown.id)) throw new Error('Drilldown dimension already selected')
    sameDataset(dataset, drilldown, `dimension ${drilldown.id}`)
    if (!Array.isArray(request.parentFilters) || request.parentFilters.length === 0) throw new Error('Drilldown requires at least one parent filter')
    for (const parent of request.parentFilters) {
      const filter = resolveFilter(model, dataset, { dimension: parent.dimension, operator: 'in', values: parent.values })
      if (!dimensions.some(selected => selected.id === filter.dimension.id)) throw new Error('Drilldown parent dimension must be selected')
      filters.push(filter)
    }
    if (filters.length > model.limits.maxFilters) throw new Error('Too many filters')
    dimensions.push(drilldown)
  }
  if (dimensions.length > model.limits.maxDimensions) throw new Error('Too many dimensions')
  const limit = request.limit ?? model.limits.maxTopN
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > model.limits.maxTopN) throw new Error('Invalid analysis limit')
  const timeGrain = resolveTimeGrain(model, dimensions, request.timeGrain, request.intent)
  if (request.intent === 'trend' && calendarBucketCount(range, timeGrain!) > budgets.maxBuckets) throw new Error('Trend exceeds bucket budget')
  const sort = resolveSort(request.sort, metrics)
  return Object.freeze({ dataset, ...range, metrics: Object.freeze(metrics), ...resolveDerivedMetricOrder(model, metrics),
    dimensions: Object.freeze(dimensions), filters: Object.freeze(filters), ...(comparison === undefined ? {} : { comparison }),
    ...(timeGrain === undefined ? {} : { timeGrain }), ...(sort === undefined ? {} : { sort }), limit, intent: request.intent })
}
