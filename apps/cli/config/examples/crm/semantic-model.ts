/** Closed CRM business metrics and dimensions backed by configured logical datasets. */
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { Dataset } from './elasticsearch.ts'

/** Display format for a model-visible metric value. */
export type MetricFormat = 'currency' | 'number' | 'decimal'
/** Time grouping accepted by configured date dimensions. */
export type TimeGrain = 'day' | 'week' | 'month'
/** Equality-based filter operators accepted by configured dimensions. */
export type DimensionFilter = 'equals' | 'in'

interface MetricBase {
  id: string
  name: string
  dataset: string
  format: MetricFormat
  description: string
  limitations: readonly string[]
}

/** Sum a configured numeric logical field. */
export interface SumMetricDefinition extends MetricBase {
  kind: 'sum'
  field: string
}

/** Count documents in the configured logical dataset. */
export interface CountMetricDefinition extends MetricBase { kind: 'count' }

/** Count distinct configured logical field values. */
export interface DistinctCountMetricDefinition extends MetricBase {
  kind: 'distinct_count'
  field: string
}

/** Divide the first named metric by the second named metric. */
export interface RatioMetricDefinition extends MetricBase {
  kind: 'ratio'
  dependencies: readonly [string, string]
}

/** Name a business metric that the configured sources cannot calculate. */
export interface UnavailableMetricDefinition extends MetricBase { kind: 'unavailable' }

/** One configured business metric. */
export type MetricDefinition = SumMetricDefinition | CountMetricDefinition | DistinctCountMetricDefinition
  | RatioMetricDefinition | UnavailableMetricDefinition

/** One allowlisted business grouping or filter. */
export interface DimensionDefinition {
  id: string
  name: string
  dataset: string
  field: string
  dataType: 'date' | 'keyword'
  filters: readonly DimensionFilter[]
  timeGrains?: readonly TimeGrain[]
  description: string
  limitations: readonly string[]
}

/** Deployment-owned business definitions and analysis limits. */
export interface SemanticConfig {
  metrics: MetricDefinition[]
  dimensions: DimensionDefinition[]
  maxSelectedMetrics: number
  maxDimensions: number
  maxFilters: number
  maxTopN: number
  maxFilterValues: number
  maxInputChars: number
  maxRequestBytes: number
  timeGrains: TimeGrain[]
}

/** Immutable, validated catalog used by semantic planning and execution. */
export interface ResolvedSemanticModel {
  readonly metrics: ReadonlyMap<string, MetricDefinition>
  readonly dimensions: ReadonlyMap<string, DimensionDefinition>
  readonly limits: Readonly<Omit<SemanticConfig, 'metrics' | 'dimensions' | 'timeGrains'>> & { readonly timeGrains: readonly TimeGrain[] }
  /** Return model-facing metric metadata without configured source fields.
   * @returns Safe metric catalog.
   */
  metricCatalog(): JsonValue
  /** Return model-facing dimension metadata without configured source fields.
   * @returns Safe dimension catalog.
   */
  dimensionCatalog(): JsonValue
}

const metricFormats = new Set<MetricFormat>(['currency', 'number', 'decimal'])
const metricKinds = new Set<string>(['sum', 'count', 'distinct_count', 'ratio', 'unavailable'])
const timeGrains = new Set<TimeGrain>(['day', 'week', 'month'])
const dimensionFilters = new Set<DimensionFilter>(['equals', 'in'])
const id = /^[a-z][a-z0-9_]*$/

function validText(value: string): boolean { return value.trim().length > 0 }

function validateId(value: string, label: string): void {
  if (!id.test(value)) throw new Error(`Invalid ${label} id`)
}

function validateCommon(definition: MetricDefinition): void {
  validateId(definition.id, 'metric')
  if (!validText(definition.name) || !validText(definition.description)) throw new Error('Metric name and description are required')
  if (!metricFormats.has(definition.format)) throw new Error('Invalid metric format')
  if (!Array.isArray(definition.limitations) || definition.limitations.some(limitation => !validText(limitation))) {
    throw new Error('Invalid metric limitations')
  }
  if (definition.kind === 'unavailable' && definition.limitations.length === 0) {
    throw new Error('Unavailable metric requires a concrete limitation')
  }
}

function sourceField(dataset: Dataset, key: string): string | undefined {
  if (key === 'amount') return dataset.amountField
  if (key === 'customer') return dataset.customerField
  if (key === 'time') return dataset.timeField
  return dataset.measures?.[key] ?? dataset.dimensions[key]
}

function validateMetricField(definition: SumMetricDefinition | DistinctCountMetricDefinition, datasets: Record<string, Dataset>): void {
  const dataset = datasets[definition.dataset]
  if (!dataset) throw new Error(`Unknown metric dataset ${definition.dataset}`)
  if (!sourceField(dataset, definition.field)) throw new Error(`Unknown metric field ${definition.field}`)
  if (definition.kind === 'sum' && definition.field !== 'amount' && !Object.hasOwn(dataset.measures ?? {}, definition.field)) {
    throw new Error(`Metric sum field ${definition.field} must be an amount or configured measure`)
  }
}

function validateMetric(definition: MetricDefinition, datasets: Record<string, Dataset>): void {
  const kind = definition.kind as string
  if (!metricKinds.has(kind)) throw new Error(`Unknown metric kind ${kind}`)
  validateCommon(definition)
  if (!Object.hasOwn(datasets, definition.dataset)) throw new Error(`Unknown metric dataset ${definition.dataset}`)
  switch (definition.kind) {
    case 'sum':
    case 'distinct_count': validateMetricField(definition, datasets); break
    case 'count': break
    case 'ratio':
      if (!Array.isArray(definition.dependencies) || definition.dependencies.length !== 2
        || definition.dependencies.some(dependency => !id.test(dependency))) throw new Error('Ratio requires two metric dependencies')
      break
    case 'unavailable': break
    default: throw new Error(`Unknown metric kind ${kind}`)
  }
}

function validateDimension(definition: DimensionDefinition, datasets: Record<string, Dataset>, configuredGrains: Set<TimeGrain>): void {
  validateId(definition.id, 'dimension')
  if (!validText(definition.name) || !validText(definition.description)) throw new Error('Dimension name and description are required')
  if (!Object.hasOwn(datasets, definition.dataset)) throw new Error(`Unknown dimension dataset ${definition.dataset}`)
  const dataset = datasets[definition.dataset]!
  const field = definition.field === 'time' ? dataset.timeField : dataset.dimensions[definition.field]
  if (!field) throw new Error(`Unknown dimension field ${definition.field}`)
  if (definition.dataType !== 'date' && definition.dataType !== 'keyword') throw new Error('Invalid dimension data type')
  if (!Array.isArray(definition.filters) || definition.filters.length === 0
    || definition.filters.some(filter => !dimensionFilters.has(filter))) {
    throw new Error('Invalid dimension filters')
  }
  if (new Set(definition.filters).size !== definition.filters.length) throw new Error('Duplicate dimension filters')
  if (definition.dataType === 'date') {
    if (definition.field !== 'time' || !definition.timeGrains?.length || definition.timeGrains.some(grain => !configuredGrains.has(grain))) {
      throw new Error('Invalid date dimension time grains')
    }
  } else if (definition.timeGrains?.length) throw new Error('Only date dimensions support time grains')
  if (!Array.isArray(definition.limitations) || definition.limitations.some(limitation => !validText(limitation))) throw new Error('Invalid dimension limitations')
}

function dependencies(definition: MetricDefinition): readonly string[] {
  return definition.kind === 'ratio' ? definition.dependencies : []
}

function validateDependencies(metrics: ReadonlyMap<string, MetricDefinition>): void {
  for (const definition of metrics.values()) {
    for (const dependency of dependencies(definition)) {
      const target = metrics.get(dependency)
      if (!target) throw new Error(`Unknown metric dependency ${dependency}`)
      if (target.kind === 'unavailable') throw new Error(`Unavailable metric dependency ${dependency}`)
      if (target.dataset !== definition.dataset) throw new Error('Incompatible metric dependency datasets')
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (definition: MetricDefinition): void => {
    if (visited.has(definition.id)) return
    if (visiting.has(definition.id)) throw new Error('Cyclic metric dependency')
    visiting.add(definition.id)
    for (const dependency of dependencies(definition)) visit(metrics.get(dependency)!)
    visiting.delete(definition.id)
    visited.add(definition.id)
  }
  for (const definition of metrics.values()) visit(definition)
}

function freezeMetric(definition: MetricDefinition): MetricDefinition {
  const common = { ...definition, limitations: Object.freeze([...definition.limitations]) }
  if (definition.kind === 'ratio') return Object.freeze({ ...common, dependencies: Object.freeze([...definition.dependencies]) as [string, string] })
  return Object.freeze(common)
}

function freezeDimension(definition: DimensionDefinition): DimensionDefinition {
  return Object.freeze({ ...definition, filters: Object.freeze([...definition.filters]),
    ...(definition.timeGrains === undefined ? {} : { timeGrains: Object.freeze([...definition.timeGrains]) }),
    limitations: Object.freeze([...definition.limitations]) })
}

function immutableMap<T>(entries: readonly (readonly [string, T])[]): ReadonlyMap<string, T> {
  const values = new Map(entries)
  const result: ReadonlyMap<string, T> = {
    get size() { return values.size },
    has: values.has.bind(values), get: values.get.bind(values), entries: values.entries.bind(values), keys: values.keys.bind(values),
    values: values.values.bind(values),
    forEach(callbackfn, thisArg) {
      values.forEach((value, key) => { callbackfn.call(thisArg, value, key, result) })
    },
    [Symbol.iterator]: values[Symbol.iterator].bind(values),
  }
  return Object.freeze(result)
}

function catalogMetric(definition: MetricDefinition): JsonValue {
  return { id: definition.id, name: definition.name, dataset: definition.dataset, format: definition.format,
    kind: definition.kind, available: definition.kind !== 'unavailable', description: definition.description,
    dependencies: [...dependencies(definition)], limitations: [...definition.limitations] }
}

function catalogDimension(definition: DimensionDefinition): JsonValue {
  return { id: definition.id, name: definition.name, dataset: definition.dataset, dataType: definition.dataType,
    filters: [...definition.filters], ...(definition.timeGrains === undefined ? {} : { timeGrains: [...definition.timeGrains] }),
    description: definition.description, limitations: [...definition.limitations] }
}

/** Validate deployment-owned semantic definitions and produce immutable lookup catalogs.
 * @param config Explicit semantic definitions and limits.
 * @param datasets Logical dataset mappings from the Elasticsearch configuration.
 * @returns Model-safe semantic catalog and immutable internal lookups.
 * @throws {Error} When definitions, dependencies, logical mappings, or limits are invalid.
 */
export function resolveSemanticModel(config: SemanticConfig, datasets: Record<string, Dataset>): ResolvedSemanticModel {
  for (const key of ['maxSelectedMetrics', 'maxDimensions', 'maxFilters', 'maxTopN', 'maxFilterValues', 'maxInputChars', 'maxRequestBytes'] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] <= 0) throw new Error(`Invalid ${key}`)
  }
  if (config.maxSelectedMetrics > 5) throw new Error('Invalid maxSelectedMetrics')
  if (config.maxDimensions > 2) throw new Error('Invalid maxDimensions')
  if (config.maxFilterValues > 50) throw new Error('Invalid maxFilterValues')
  if (config.maxInputChars > 256) throw new Error('Invalid maxInputChars')
  if (config.maxRequestBytes > 32768) throw new Error('Invalid maxRequestBytes')
  if (!Array.isArray(config.timeGrains) || config.timeGrains.length === 0 || config.timeGrains.some(grain => !timeGrains.has(grain))
    || new Set(config.timeGrains).size !== config.timeGrains.length) throw new Error('Invalid semantic time grains')
  const metrics = new Map<string, MetricDefinition>()
  for (const definition of config.metrics) {
    validateMetric(definition, datasets)
    if (metrics.has(definition.id)) throw new Error(`Duplicate metric id ${definition.id}`)
    metrics.set(definition.id, freezeMetric(definition))
  }
  const dimensions = new Map<string, DimensionDefinition>()
  const configuredGrains = new Set(config.timeGrains)
  for (const definition of config.dimensions) {
    validateDimension(definition, datasets, configuredGrains)
    if (dimensions.has(definition.id)) throw new Error(`Duplicate dimension id ${definition.id}`)
    dimensions.set(definition.id, freezeDimension(definition))
  }
  validateDependencies(metrics)
  const availableMetricDatasets = new Set([...metrics.values()]
    .filter(definition => definition.kind !== 'unavailable').map(definition => definition.dataset))
  for (const definition of dimensions.values()) {
    if (!availableMetricDatasets.has(definition.dataset)) {
      throw new Error(`Dimension dataset ${definition.dataset} has no available metric`)
    }
  }
  const limits = Object.freeze({ maxSelectedMetrics: config.maxSelectedMetrics, maxDimensions: config.maxDimensions,
    maxFilters: config.maxFilters, maxTopN: config.maxTopN, maxFilterValues: config.maxFilterValues,
    maxInputChars: config.maxInputChars, maxRequestBytes: config.maxRequestBytes, timeGrains: Object.freeze([...config.timeGrains]) })
  const metricMap = immutableMap([...metrics.entries()])
  const dimensionMap = immutableMap([...dimensions.entries()])
  const catalogLimits = () => ({ maxSelectedMetrics: limits.maxSelectedMetrics, maxDimensions: limits.maxDimensions,
    maxFilters: limits.maxFilters, maxTopN: limits.maxTopN, maxFilterValues: limits.maxFilterValues,
    maxInputChars: limits.maxInputChars, maxRequestBytes: limits.maxRequestBytes, timeGrains: [...limits.timeGrains] })
  return Object.freeze({ metrics: metricMap, dimensions: dimensionMap, limits,
    metricCatalog: () => ({ metrics: [...metricMap.values()].map(catalogMetric), limits: catalogLimits() }),
    dimensionCatalog: () => ({ dimensions: [...dimensionMap.values()].map(catalogDimension), limits: catalogLimits() }),
  })
}
