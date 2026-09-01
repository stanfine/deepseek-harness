/** Compile resolved CRM analyses into bounded Elasticsearch aggregations and aggregate-only results. */
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { AnalysisSort, ResolvedAnalysisPlan } from './analysis-planner.ts'
import type { ConfiguredAggregationSource, ElasticsearchReader } from './elasticsearch.ts'
import type { DimensionDefinition, MetricDefinition, ResolvedSemanticModel } from './semantic-model.ts'

type ObjectValue = { [key: string]: JsonValue }
type DimensionValue = string | number
/** Maximum UTF-8 bytes published for the complete persisted CRM analysis wrapper. */
export const CRM_ANALYSIS_MAX_BYTES = 1048576

/** One current or comparison value for a selected business metric. */
export interface MetricValue {
  value: number | null
  comparisonValue?: number | null
  changeRatio?: number | null
  unavailableReason?: string
  comparisonUnavailableReason?: string
  changeUnavailableReason?: string
}

/** One aggregate row with business dimensions separated from metric values. */
export interface AnalysisRow {
  dimensions: Record<string, DimensionValue>
  metrics: Record<string, MetricValue>
}

/** Completeness facts that determine whether rows can support contribution totals. */
export interface AnalysisCompleteness {
  complete: boolean
  missingDimensionDocuments: number
  omittedDocuments: number
  limitedRows: number
  countErrorUpperBound: number
  approximateMetrics: string[]
  missingMetricValues: number
}

/** Versioned, model-safe result produced from one resolved semantic plan. */
export interface SemanticAnalysisResultV1 {
  version: 1
  request: {
    metrics: string[]
    dimensions: string[]
    filters: { dimension: string; operator: 'equals' | 'in'; values: string[] }[]
    start: string
    end: string
    intent: ResolvedAnalysisPlan['intent']
    comparison?: NonNullable<ResolvedAnalysisPlan['comparison']>['kind']
    timeGrain?: NonNullable<ResolvedAnalysisPlan['timeGrain']>
    sort?: AnalysisSort
    limit: number
  }
  columns: {
    dimensions: { id: string; name: string; dataType: DimensionDefinition['dataType']; composition: 'mutually_exclusive' | 'overlapping' | 'high_cardinality' | 'unknown' }[]
    metrics: { id: string; name: string; format: MetricDefinition['format']; additivity: 'additive' | 'non_additive'; description: string; limitations: string[] }[]
  }
  rows: AnalysisRow[]
  coverage: {
    current: { start: string; end: string; recordCount: number; available: true; observedStart: string | null }
    comparison?: {
      kind: NonNullable<ResolvedAnalysisPlan['comparison']>['kind']
      start: string
      end: string
      recordCount: number
      available: boolean
      observedStart: string | null
      reason?: string
    }
  }
  completeness: AnalysisCompleteness
  warnings: string[]
  drilldownDimensions: string[]
}

interface ParsedMetric {
  value: number | null
  reason?: string
}

interface ParsedRow {
  dimensions: Record<string, DimensionValue>
  joinKey: string
  sourceKey: string
  values: Map<string, ParsedMetric>
}

interface ParseCompleteness {
  missingBuckets: number
  omittedBuckets: number
  countErrorUpperBound: number
}

interface AnalysisWindow { start: string; end: string }

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Elasticsearch aggregation response')
  return value as ObjectValue
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid Elasticsearch bucket count')
  return value
}

function metricNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid Elasticsearch metric value')
  return value
}

function calendarDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid Elasticsearch date bucket')
  const instant = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== value) throw new Error('Invalid Elasticsearch date bucket')
  return value
}

function lastDate(end: string): string {
  return new Date(Date.parse(`${end}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
}

function dateText(value: Date): string { return value.toISOString().slice(0, 10) }

function firstCalendarBucket(start: string, grain: NonNullable<ResolvedAnalysisPlan['timeGrain']>): Date {
  const value = new Date(`${start}T00:00:00Z`)
  if (grain === 'week') value.setUTCDate(value.getUTCDate() - (value.getUTCDay() + 6) % 7)
  else if (grain === 'month') value.setUTCDate(1)
  return value
}

function nextCalendarBucket(value: Date, grain: NonNullable<ResolvedAnalysisPlan['timeGrain']>): Date {
  const result = new Date(value)
  if (grain === 'day') result.setUTCDate(result.getUTCDate() + 1)
  else if (grain === 'week') result.setUTCDate(result.getUTCDate() + 7)
  else result.setUTCMonth(result.getUTCMonth() + 1)
  return result
}

function calendarBuckets(window: AnalysisWindow, grain: NonNullable<ResolvedAnalysisPlan['timeGrain']>, countLimit?: number): string[] {
  const last = lastDate(window.end)
  const result: string[] = []
  let bucket = firstCalendarBucket(window.start, grain)
  while (countLimit === undefined ? dateText(bucket) <= last : result.length < countLimit) {
    result.push(dateText(bucket))
    bucket = nextCalendarBucket(bucket, grain)
  }
  return result
}

function rangeFilter(source: ConfiguredAggregationSource, start: string, end: string): JsonValue {
  return { range: { [source.dimensionField('time')]: {
    gte: `${start}T00:00:00${source.timeZone}`, lt: `${end}T00:00:00${source.timeZone}`,
  } } }
}

function sourceAggregations(source: ConfiguredAggregationSource, plan: ResolvedAnalysisPlan): ObjectValue {
  const aggs: ObjectValue = {}
  plan.sourceMeasures.forEach((metric, index) => {
    if (metric.kind === 'sum') {
      const field = source.metricField(metric.field)
      aggs[`m${index}`] = { sum: { field } }
      aggs[`m${index}_missing`] = { missing: { field } }
    }
  })
  return aggs
}

function filterEnd(value: string, grain: NonNullable<ResolvedAnalysisPlan['timeGrain']>): string {
  return dateText(nextCalendarBucket(new Date(`${value}T00:00:00Z`), grain))
}

function relativeBucketValue(value: string, plan: ResolvedAnalysisPlan, window: AnalysisWindow): string {
  if (window.start === plan.start) return value
  const grain = plan.timeGrain ?? 'day'
  const index = calendarBuckets(plan, grain).indexOf(value)
  if (index < 0) throw new Error('Drilldown date parent is outside the current bucket sequence')
  const shifted = calendarBuckets(window, grain)
  if (index >= shifted.length) throw new Error('Drilldown date parent has no comparison bucket')
  return shifted[index]!
}

function queryFilters(
  source: ConfiguredAggregationSource, plan: ResolvedAnalysisPlan, window: AnalysisWindow, relative: boolean,
): JsonValue[] {
  const filters: JsonValue[] = []
  for (const filter of plan.filters.filter(candidate => Boolean(candidate.relativeToWindow) === relative)) {
    const field = source.dimensionField(filter.dimension.field)
    if (filter.dimension.dataType === 'date') {
      const grain = filter.relativeToWindow ? plan.timeGrain ?? 'day' : 'day'
      const ranges = filter.values.map((sourceValue) => {
        const value = filter.relativeToWindow
          ? relativeBucketValue(sourceValue, plan, window)
          : sourceValue
        return { range: { [field]: {
          gte: `${value}T00:00:00${source.timeZone}`,
          lt: `${filterEnd(value, grain)}T00:00:00${source.timeZone}`,
        } } }
      })
      filters.push(ranges.length === 1 ? ranges[0]! : { bool: { should: ranges, minimum_should_match: 1 } })
    } else filters.push(filter.operator === 'equals'
      ? { term: { [field]: filter.values[0]! } }
      : { terms: { [field]: [...filter.values] } })
  }
  return filters
}

function dimensionAggregations(
  source: ConfiguredAggregationSource, plan: ResolvedAnalysisPlan, start: string, end: string, depth = 0,
): ObjectValue {
  if (depth === plan.dimensions.length) return sourceAggregations(source, plan)
  const dimension = plan.dimensions[depth]!
  const field = source.dimensionField(dimension.field)
  const child = dimensionAggregations(source, plan, start, end, depth + 1)
  const aggregation = dimension.dataType === 'date'
    ? { date_histogram: { field, calendar_interval: plan.timeGrain!, time_zone: source.timeZone, format: 'yyyy-MM-dd',
      min_doc_count: 0, extended_bounds: { min: start, max: lastDate(end) }, order: { _key: 'asc' } }, aggs: child }
    : { terms: { field, size: source.maxBuckets, show_term_doc_count_error: true, order: { _key: 'asc' } }, aggs: child }
  return { [`d${depth}`]: aggregation, [`d${depth}_missing`]: { missing: { field } } }
}

function compile(source: ConfiguredAggregationSource, plan: ResolvedAnalysisPlan): JsonValue {
  const aggs: ObjectValue = {
    source_coverage: { min: { field: source.dimensionField('time') } },
    current: { filter: plan.filters.some(filter => filter.relativeToWindow)
      ? { bool: { filter: [rangeFilter(source, plan.start, plan.end), ...queryFilters(source, plan, plan, true)] } }
      : rangeFilter(source, plan.start, plan.end),
    aggs: dimensionAggregations(source, plan, plan.start, plan.end) },
  }
  if (plan.comparison) aggs.comparison = { filter: plan.filters.some(filter => filter.relativeToWindow)
    ? { bool: { filter: [rangeFilter(source, plan.comparison.start, plan.comparison.end),
      ...queryFilters(source, plan, plan.comparison, true)] } }
    : rangeFilter(source, plan.comparison.start, plan.comparison.end),
  aggs: dimensionAggregations(source, plan, plan.comparison.start, plan.comparison.end) }
  return { size: 0, query: { bool: { filter: [...source.baseFilters, ...queryFilters(source, plan, plan, false)] } }, aggs }
}

function sourceValue(container: ObjectValue, metric: ResolvedAnalysisPlan['sourceMeasures'][number], index: number): ParsedMetric {
  if (metric.kind === 'count') return { value: count(container.doc_count) }
  if (metric.kind === 'distinct_count') return { value: 0 }
  const documents = count(container.doc_count)
  const coverage = object(container[`m${index}_missing`])
  const missingDocuments = count(coverage.doc_count)
  if (missingDocuments > documents) throw new Error('Invalid Elasticsearch metric field coverage')
  if (missingDocuments > 0) return { value: null, reason: `${missingDocuments} matching documents have missing ${metric.id} values` }
  const value = metricNumber(object(container[`m${index}`]).value)
  return { value }
}

function resolveDerived(plan: ResolvedAnalysisPlan, values: Map<string, ParsedMetric>): void {
  for (const metric of plan.derivedMetrics) {
    const numerator = values.get(metric.dependencies[0])
    const denominator = values.get(metric.dependencies[1])
    if (!numerator || numerator.value === null) values.set(metric.id, { value: null, reason: `${metric.dependencies[0]} is unavailable` })
    else if (!denominator || denominator.value === null) values.set(metric.id, { value: null, reason: `${metric.dependencies[1]} is unavailable` })
    else if (denominator.value === 0) values.set(metric.id, { value: null, reason: `${metric.dependencies[1]} is zero` })
    else values.set(metric.id, { value: numerator.value / denominator.value })
  }
}

function derivedValues(plan: ResolvedAnalysisPlan, container: ObjectValue): Map<string, ParsedMetric> {
  const values = new Map<string, ParsedMetric>()
  plan.sourceMeasures.forEach((metric, index) => values.set(metric.id, sourceValue(container, metric, index)))
  resolveDerived(plan, values)
  return values
}

function parseRows(
  plan: ResolvedAnalysisPlan, container: ObjectValue, completeness: ParseCompleteness, maxBuckets: number,
  window: AnalysisWindow, normalizedWindow: AnalysisWindow,
  dimensions: Record<string, DimensionValue> = {},
  sourceDimensions: Record<string, DimensionValue> = {}, join: string[] = [], depth = 0,
): ParsedRow[] {
  if (depth === plan.dimensions.length) return [{ dimensions, joinKey: join.join('\u0000'),
    sourceKey: JSON.stringify(plan.dimensions.map(dimension => sourceDimensions[dimension.id])), values: derivedValues(plan, container) }]
  const definition = plan.dimensions[depth]!
  const missing = object(container[`d${depth}_missing`])
  completeness.missingBuckets += count(missing.doc_count)
  const grouping = object(container[`d${depth}`])
  if (!Array.isArray(grouping.buckets)) throw new Error('Invalid Elasticsearch semantic buckets')
  if (grouping.buckets.length > maxBuckets) throw new Error('Elasticsearch semantic bucket limit exceeded')
  if (definition.dataType === 'keyword') {
    completeness.omittedBuckets += count(grouping.sum_other_doc_count)
    completeness.countErrorUpperBound += count(grouping.doc_count_error_upper_bound)
  }
  const expectedDates = definition.dataType === 'date' ? calendarBuckets(window, plan.timeGrain!) : undefined
  if (expectedDates && grouping.buckets.length !== expectedDates.length) throw new Error('Invalid Elasticsearch calendar bucket sequence')
  const normalizedDates = expectedDates ? calendarBuckets(normalizedWindow, plan.timeGrain!, expectedDates.length) : undefined
  const rows: ParsedRow[] = []
  grouping.buckets.forEach((raw, index) => {
    const bucket = object(raw)
    count(bucket.doc_count)
    let value: DimensionValue
    let sourceValue: DimensionValue
    let joinPart: string
    if (definition.dataType === 'date') {
      sourceValue = calendarDate(bucket.key_as_string)
      if (sourceValue !== expectedDates![index]) throw new Error('Invalid Elasticsearch calendar bucket sequence')
      value = normalizedDates![index]!
      joinPart = `date:${depth}:${index}`
    } else {
      if (typeof bucket.key !== 'string' && typeof bucket.key !== 'number') throw new Error('Invalid Elasticsearch semantic bucket key')
      value = bucket.key
      sourceValue = value
      joinPart = `key:${JSON.stringify(value)}`
    }
    rows.push(...parseRows(plan, bucket, completeness, maxBuckets, window, normalizedWindow,
      { ...dimensions, [definition.id]: value }, { ...sourceDimensions, [definition.id]: sourceValue },
      [...join, joinPart], depth + 1))
  })
  return rows
}

function distinctSources(
  source: ConfiguredAggregationSource, plan: ResolvedAnalysisPlan,
  metric: Extract<MetricDefinition, { kind: 'distinct_count' }>,
): JsonValue[] {
  const dimensions = plan.dimensions.map((dimension, index) => ({
    [`d${index}`]: dimension.dataType === 'date'
      ? { date_histogram: { field: source.dimensionField(dimension.field), calendar_interval: plan.timeGrain!,
        time_zone: source.timeZone, format: 'yyyy-MM-dd', order: 'asc' } }
      : { terms: { field: source.dimensionField(dimension.field), order: 'asc' } },
  }))
  return [...dimensions, { customer: { terms: { field: source.metricField(metric.field) } } }]
}

function compositeSourceKey(plan: ResolvedAnalysisPlan, key: ObjectValue): string {
  const dimensions = plan.dimensions.map((dimension, index) => {
    const value = key[`d${index}`]
    if (dimension.dataType === 'date') return calendarDate(value)
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Invalid Elasticsearch distinct dimension key')
    return value
  })
  const customer = key.customer
  if (typeof customer !== 'string' && typeof customer !== 'number') throw new Error('Invalid Elasticsearch distinct identifier key')
  return JSON.stringify(dimensions)
}

async function exactDistinctValues(
  source: ConfiguredAggregationSource, plan: ResolvedAnalysisPlan, start: string, end: string,
  search: (body: JsonValue) => Promise<JsonValue>,
): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>()
  for (const metric of plan.sourceMeasures) {
    if (metric.kind !== 'distinct_count') continue
    const values = new Map<string, number>()
    let after: JsonValue | undefined
    for (let page = 0; page < source.maxDistinctPages; page++) {
      const composite: ObjectValue = { size: source.distinctPageSize, sources: distinctSources(source, plan, metric) }
      if (after !== undefined) composite.after = after
      const response = object(await search({ size: 0, query: { bool: { filter: [
        ...source.baseFilters, rangeFilter(source, start, end), ...queryFilters(source, plan, { start, end }, false),
        ...queryFilters(source, plan, { start, end }, true),
      ] } }, aggs: { distinct: { composite } } }))
      const distinct = object(object(response.aggregations).distinct)
      if (!Array.isArray(distinct.buckets) || distinct.buckets.length > source.distinctPageSize) {
        throw new Error('Invalid Elasticsearch distinct buckets')
      }
      for (const raw of distinct.buckets) {
        const bucket = object(raw)
        const key = compositeSourceKey(plan, object(bucket.key))
        values.set(key, (values.get(key) ?? 0) + 1)
      }
      if (distinct.after_key === undefined) {
        result.set(metric.id, values)
        after = undefined
        break
      }
      if (distinct.buckets.length === 0) throw new Error('Invalid Elasticsearch distinct empty page with after key')
      after = object(distinct.after_key)
    }
    if (after !== undefined) throw new Error(`Exact distinct count exceeds page budget for ${metric.id}`)
  }
  return result
}

function applyDistinctValues(
  plan: ResolvedAnalysisPlan, rows: ParsedRow[], exact: ReadonlyMap<string, ReadonlyMap<string, number>>,
): void {
  for (const row of rows) {
    for (const metric of plan.sourceMeasures) {
      if (metric.kind === 'distinct_count') row.values.set(metric.id, { value: exact.get(metric.id)?.get(row.sourceKey) ?? 0 })
    }
    resolveDerived(plan, row.values)
  }
}

function observedStart(value: JsonValue | undefined, timeZone: string): string | null {
  const raw = object(value).value
  if (raw === null) return null
  const timestamp = metricNumber(raw)
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid Elasticsearch source coverage')
  const sign = timeZone.startsWith('-') ? -1 : 1
  const [hours, minutes] = timeZone.slice(1).split(':').map(Number)
  date.setUTCMinutes(date.getUTCMinutes() + sign * (hours! * 60 + minutes!))
  return date.toISOString().slice(0, 10)
}

function change(current: ParsedMetric, comparison: ParsedMetric | undefined): Pick<MetricValue, 'changeRatio' | 'changeUnavailableReason'> {
  if (current.value === null) return { changeRatio: null, changeUnavailableReason: 'current value is unavailable' }
  if (!comparison || comparison.value === null) return { changeRatio: null, changeUnavailableReason: 'comparison value is unavailable' }
  if (comparison.value === 0) return { changeRatio: null, changeUnavailableReason: 'comparison value is zero' }
  return { changeRatio: (current.value - comparison.value) / comparison.value }
}

function resultRow(
  plan: ResolvedAnalysisPlan, current: ParsedRow | undefined, comparison: ParsedRow | undefined, comparisonReason: string | undefined,
): AnalysisRow {
  const metrics: Record<string, MetricValue> = {}
  for (const definition of plan.metrics) {
    const value = current?.values.get(definition.id) ?? { value: null, reason: 'current bucket is unavailable' }
    const metric: MetricValue = { value: value.value, ...(value.reason === undefined ? {} : { unavailableReason: value.reason }) }
    if (plan.comparison) {
      const compared = comparisonReason === undefined ? comparison?.values.get(definition.id) : undefined
      metric.comparisonValue = compared?.value ?? null
      if (comparisonReason !== undefined) metric.comparisonUnavailableReason = comparisonReason
      else if (!compared) metric.comparisonUnavailableReason = 'comparison bucket is unavailable'
      else if (compared.reason !== undefined) metric.comparisonUnavailableReason = compared.reason
      Object.assign(metric, change(value, compared))
    }
    metrics[definition.id] = metric
  }
  return { dimensions: (current ?? comparison)!.dimensions, metrics }
}

function compareDateDimensions(plan: ResolvedAnalysisPlan, left: ParsedRow, right: ParsedRow): number {
  for (const dimension of plan.dimensions) {
    if (dimension.dataType !== 'date') continue
    const difference = String(left.dimensions[dimension.id]).localeCompare(String(right.dimensions[dimension.id]))
    if (difference !== 0) return difference
  }
  return 0
}

function compareRows(left: AnalysisRow, right: AnalysisRow, sort: AnalysisSort): number {
  const a = left.metrics[sort.metric]?.value
  const b = right.metrics[sort.metric]?.value
  if (a === null || a === undefined) {
    return b === null || b === undefined ? JSON.stringify(left.dimensions).localeCompare(JSON.stringify(right.dimensions)) : 1
  }
  if (b === null || b === undefined) return -1
  const difference = sort.direction === 'asc' ? a - b : b - a
  return difference || JSON.stringify(left.dimensions).localeCompare(JSON.stringify(right.dimensions))
}

function normalizedRequest(plan: ResolvedAnalysisPlan): SemanticAnalysisResultV1['request'] {
  return {
    metrics: plan.metrics.map(metric => metric.id), dimensions: plan.dimensions.map(dimension => dimension.id),
    filters: plan.filters.map(filter => ({ dimension: filter.dimension.id, operator: filter.operator, values: [...filter.values] })),
    start: plan.start, end: plan.end, intent: plan.intent,
    ...(plan.comparison === undefined ? {} : { comparison: plan.comparison.kind }),
    ...(plan.timeGrain === undefined ? {} : { timeGrain: plan.timeGrain }),
    ...(plan.sort === undefined ? {} : { sort: { ...plan.sort } }), limit: plan.limit,
  }
}

/** Execute one planner-resolved aggregate analysis through the configured reader.
 * @param reader Bounded Elasticsearch transport and configured source resolver.
 * @param model Validated semantic catalog.
 * @param plan One-dataset plan produced by `resolveAnalysisPlan`.
 * @param signal Caller cancellation.
 * @returns Complete versioned aggregate result within the configured byte limit.
 * @throws {Error} When the source response is malformed, incomplete, or the complete result exceeds its byte limit.
 */
export async function executeSemanticAnalysis(
  reader: ElasticsearchReader, model: ResolvedSemanticModel, plan: ResolvedAnalysisPlan, signal: AbortSignal,
): Promise<SemanticAnalysisResultV1> {
  const executed = await reader.aggregateConfigured(plan.dataset, async (source, search) => {
    const response = await search(compile(source, plan))
    const currentDistinct = await exactDistinctValues(source, plan, plan.start, plan.end, search)
    const comparisonDistinct = plan.comparison
      ? await exactDistinctValues(source, plan, plan.comparison.start, plan.comparison.end, search)
      : new Map<string, Map<string, number>>()
    return { response, currentDistinct, comparisonDistinct }
  }, signal)
  const response = object(executed.value.response)
  const aggregations = object(response.aggregations)
  const earliest = observedStart(aggregations.source_coverage, executed.timeZone)
  const currentContainer = object(aggregations.current)
  const currentCount = count(currentContainer.doc_count)
  const currentCompleteness: ParseCompleteness = { missingBuckets: 0, omittedBuckets: 0, countErrorUpperBound: 0 }
  const currentWindow = { start: plan.start, end: plan.end }
  const currentRows = parseRows(plan, currentContainer, currentCompleteness, executed.maxBuckets, currentWindow, currentWindow)
  applyDistinctValues(plan, currentRows, executed.value.currentDistinct)
  let comparisonRows: ParsedRow[] = []
  let comparisonCount = 0
  const comparisonCompleteness: ParseCompleteness = { missingBuckets: 0, omittedBuckets: 0, countErrorUpperBound: 0 }
  if (plan.comparison) {
    const comparisonContainer = object(aggregations.comparison)
    comparisonCount = count(comparisonContainer.doc_count)
    comparisonRows = parseRows(plan, comparisonContainer, comparisonCompleteness, executed.maxBuckets, plan.comparison, currentWindow)
    applyDistinctValues(plan, comparisonRows, executed.value.comparisonDistinct)
  }
  const currentByKey = new Map(currentRows.map(row => [row.joinKey, row]))
  const comparisonByKey = new Map(comparisonRows.map(row => [row.joinKey, row]))
  const historyUnavailable = plan.comparison !== undefined && (earliest === null || earliest > plan.comparison.start)
  const comparisonReason = historyUnavailable ? 'Source history does not cover the comparison start' : undefined
  const paired: { current: ParsedRow | undefined; comparison: ParsedRow | undefined; order: ParsedRow }[] = currentRows
    .map(row => ({ current: row, comparison: comparisonByKey.get(row.joinKey), order: row }))
  if (plan.comparison && !historyUnavailable) {
    paired.push(...comparisonRows.filter(row => !currentByKey.has(row.joinKey))
      .map(row => ({ current: undefined, comparison: row, order: row })))
  }
  paired.sort((left, right) => compareDateDimensions(plan, left.order, right.order))
  let rows = paired.map(pair => resultRow(plan, pair.current, pair.comparison, comparisonReason))
  if (plan.sort) rows.sort((left, right) => compareRows(left, right, plan.sort!))
  const limitedRows = plan.intent === 'trend' ? 0 : Math.max(0, rows.length - plan.limit)
  if (plan.intent !== 'trend') rows = rows.slice(0, plan.limit)

  const missingComparisonBuckets = plan.comparison !== undefined && !historyUnavailable
    && currentRows.some(row => !comparisonByKey.has(row.joinKey))
  const missingCurrentBuckets = plan.comparison !== undefined && !historyUnavailable
    && comparisonRows.some(row => !currentByKey.has(row.joinKey))
  const approximateMetrics: string[] = []
  const missingMetricValues = [...currentRows, ...comparisonRows].reduce((total, row) => total
    + plan.sourceMeasures.reduce((rowTotal, metric) => {
      const reason = row.values.get(metric.id)?.reason
      const match = reason === undefined ? undefined : /^(\d+) matching documents have missing/.exec(reason)
      return rowTotal + (match == null ? 0 : Number(match[1]))
    }, 0), 0)
  const completeness: AnalysisCompleteness = {
    complete: currentCompleteness.missingBuckets === 0 && currentCompleteness.omittedBuckets === 0
      && currentCompleteness.countErrorUpperBound === 0 && comparisonCompleteness.missingBuckets === 0
      && comparisonCompleteness.omittedBuckets === 0 && comparisonCompleteness.countErrorUpperBound === 0
      && approximateMetrics.length === 0 && missingMetricValues === 0 && !historyUnavailable
      && !missingComparisonBuckets && !missingCurrentBuckets
      && limitedRows === 0,
    missingDimensionDocuments: currentCompleteness.missingBuckets + comparisonCompleteness.missingBuckets,
    omittedDocuments: currentCompleteness.omittedBuckets + comparisonCompleteness.omittedBuckets,
    limitedRows,
    countErrorUpperBound: currentCompleteness.countErrorUpperBound + comparisonCompleteness.countErrorUpperBound,
    approximateMetrics, missingMetricValues,
  }
  const warnings: string[] = []
  if (completeness.missingDimensionDocuments > 0) warnings.push(`${completeness.missingDimensionDocuments} matching documents have missing dimension values.`)
  if (completeness.omittedDocuments > 0) warnings.push(`${completeness.omittedDocuments} matching documents are outside the returned terms buckets.`)
  if (completeness.limitedRows > 0) warnings.push(`${completeness.limitedRows} grouped rows are outside the requested Top N.`)
  if (completeness.countErrorUpperBound > 0) warnings.push(`Terms counts have an error bound of ${completeness.countErrorUpperBound}.`)
  if (approximateMetrics.length > 0) warnings.push(`Distinct-count metrics are approximate: ${approximateMetrics.join(', ')}.`)
  if (missingMetricValues > 0) warnings.push(`${missingMetricValues} grouped metric values are unavailable because matching documents omit configured fields; this is not a unique document count.`)
  if (historyUnavailable) warnings.push('Source history does not cover the requested comparison start.')
  if (missingComparisonBuckets) warnings.push('One or more current rows have no matching comparison bucket.')
  if (missingCurrentBuckets) warnings.push('One or more comparison rows have no matching current bucket.')

  const result: SemanticAnalysisResultV1 = {
    version: 1,
    request: normalizedRequest(plan),
    columns: {
      dimensions: plan.dimensions.map(dimension => ({ id: dimension.id, name: dimension.name, dataType: dimension.dataType,
        composition: dimension.composition ?? 'unknown' })),
      metrics: plan.metrics.map(metric => ({ id: metric.id, name: metric.name, format: metric.format,
        additivity: metric.additivity ?? (metric.kind === 'sum' || metric.kind === 'count' ? 'additive' : 'non_additive'),
        description: metric.description, limitations: [...metric.limitations] })),
    },
    rows,
    coverage: {
      current: { start: plan.start, end: plan.end, recordCount: currentCount, available: true, observedStart: earliest },
      ...(plan.comparison === undefined ? {} : { comparison: {
        kind: plan.comparison.kind, start: plan.comparison.start, end: plan.comparison.end, recordCount: comparisonCount,
        available: !historyUnavailable, observedStart: earliest,
        ...(comparisonReason === undefined ? {} : { reason: comparisonReason }),
      } }),
    },
    completeness,
    warnings,
    drilldownDimensions: plan.dimensions.length >= model.limits.maxDimensions || plan.filters.length >= model.limits.maxFilters
      ? []
      : [...model.dimensions.values()]
        .filter(dimension => dimension.dataset === plan.dataset && !plan.dimensions.some(selected => selected.id === dimension.id))
        .map(dimension => dimension.id),
  }
  const persisted = { version: 1, request: result.request, data: result }
  const bytes = Buffer.byteLength(JSON.stringify(result)) + Buffer.byteLength(JSON.stringify(persisted))
  if (bytes > Math.min(executed.maxResultBytes, CRM_ANALYSIS_MAX_BYTES)) {
    throw new Error('Semantic analysis result byte limit exceeded')
  }
  return result
}
