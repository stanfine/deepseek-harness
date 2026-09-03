/** Governed CRM marketing opportunities resolved against the semantic catalog. */
import type { ResolvedSemanticModel } from './semantic-model.ts'

/** Supported period comparison for opportunity evidence. */
export type OpportunityComparison = 'previous_period' | 'prior_year'
/** Business concepts required before member-level activation can be considered. */
export type MemberConcept = 'recency' | 'consent' | 'spend' | 'identity'

interface MetricRule { metric: string; threshold: number }
/** Detect a decrease at or beyond the configured magnitude. */
export interface DeclineRule extends MetricRule { kind: 'decline'; dimension?: string }
/** Detect an increase at or beyond the configured magnitude. */
export interface GrowthRule extends MetricRule { kind: 'growth' }
/** Detect grouped values above their peer average. */
export interface AboveAverageRule extends MetricRule { kind: 'above_average'; dimension: string }
/** Detect grouped values below their peer average. */
export interface BelowAverageRule extends MetricRule { kind: 'below_average'; dimension: string }
/** Closed deterministic opportunity rule. */
export type OpportunityRule = DeclineRule | GrowthRule | AboveAverageRule | BelowAverageRule

/** Aggregate audience condition that can be estimated from a semantic dimension. */
export interface DimensionAudienceCondition { kind: 'dimension_value'; dimension: string }
/** Member condition retained as unavailable until governed member concepts exist. */
export interface MemberAudienceCondition { kind: 'member_segment'; segment: 'inactive' | 'recent_buyer' }
/** Closed aggregate audience condition. */
export type AudienceCondition = DimensionAudienceCondition | MemberAudienceCondition

/** Deployment-owned definition for one marketing opportunity. */
export interface OpportunityDefinition {
  id: string
  title: string
  dataset: string
  comparison: OpportunityComparison
  rule: OpportunityRule
  primaryMetrics: string[]
  guardrailMetrics: string[]
  impactWeight: number
  riskWeight: number
  actionTemplate: string
  audienceConditions: AudienceCondition[]
  audienceEstimateMetric?: string
  audiencePolicyId?: string
  requiredConcepts?: MemberConcept[]
  limitations: string[]
}

/** Deployment-owned marketing model configuration. */
export interface MarketingConfig { opportunities: OpportunityDefinition[] }

/** Model-visible summary of one governed opportunity. */
export interface OpportunityCatalogItem {
  id: string
  title: string
  comparison: OpportunityComparison
  available: boolean
  unavailableReason?: string
  primaryMetrics: readonly string[]
  guardrailMetrics: readonly string[]
  actionTemplate: string
  limitations: readonly string[]
}

/** Immutable governed opportunity catalog and lookup. */
export interface MarketingModel {
  opportunityCatalog(): readonly OpportunityCatalogItem[]
  resolveOpportunity(id: string): OpportunityDefinition
}

const ids = /^[a-z][a-z0-9_]*$/
const comparisons = new Set<OpportunityComparison>(['previous_period', 'prior_year'])
const memberConcepts: readonly MemberConcept[] = ['recency', 'consent', 'spend', 'identity']

function exactKeys(value: object, allowed: readonly string[], label: string): void {
  const invalid = Object.keys(value).filter(key => !allowed.includes(key))
  if (invalid.length > 0) throw new Error(`Invalid ${label} keys: ${invalid.join(', ')}`)
}

function validateRule(rule: OpportunityRule): void {
  if (!rule || typeof rule !== 'object') throw new Error('Invalid opportunity rule')
  const dimensional = rule.kind === 'decline' || rule.kind === 'above_average' || rule.kind === 'below_average'
  if (!['decline', 'growth', 'above_average', 'below_average'].includes(rule.kind)) throw new Error('Invalid opportunity rule kind')
  exactKeys(rule, dimensional ? ['kind', 'metric', 'threshold', 'dimension'] : ['kind', 'metric', 'threshold'], 'opportunity rule')
  if (!Number.isFinite(rule.threshold) || rule.threshold <= 0 || rule.threshold > 1) throw new Error('Invalid opportunity threshold')
  if (!ids.test(rule.metric)) throw new Error('Invalid opportunity rule metric')
  if ((rule.kind === 'above_average' || rule.kind === 'below_average') && !ids.test(rule.dimension)) {
    throw new Error('Invalid opportunity rule dimension')
  }
  if (rule.kind === 'decline' && rule.dimension !== undefined && !ids.test(rule.dimension)) throw new Error('Invalid opportunity rule dimension')
}

function validateAudience(condition: AudienceCondition): void {
  if (!condition || typeof condition !== 'object' || !['dimension_value', 'member_segment'].includes(condition.kind)) {
    throw new Error('Invalid audience condition')
  }
  if (condition.kind === 'dimension_value') {
    exactKeys(condition, ['kind', 'dimension'], 'audience condition')
    if (!ids.test(condition.dimension)) throw new Error('Invalid audience condition')
  } else {
    exactKeys(condition, ['kind', 'segment'], 'audience condition')
    if (!['inactive', 'recent_buyer'].includes(condition.segment)) throw new Error('Invalid audience condition')
  }
}

function metricDataset(semantic: ResolvedSemanticModel, id: string): string {
  const metric = semantic.metrics.get(id)
  if (!metric) throw new Error(`Unknown opportunity metric ${id}`)
  return metric.dataset
}

function dimensionDataset(semantic: ResolvedSemanticModel, id: string): string {
  const dimension = semantic.dimensions.get(id)
  if (!dimension) throw new Error(`Unknown opportunity dimension ${id}`)
  return dimension.dataset
}

function freezeDefinition(value: OpportunityDefinition): OpportunityDefinition {
  const rule = Object.freeze({ ...value.rule })
  const audienceConditions = Object.freeze(value.audienceConditions.map(condition => Object.freeze({ ...condition })))
  return Object.freeze({ ...value, rule, primaryMetrics: Object.freeze([...value.primaryMetrics]),
    guardrailMetrics: Object.freeze([...value.guardrailMetrics]), audienceConditions,
    ...(value.requiredConcepts === undefined ? {} : { requiredConcepts: Object.freeze([...value.requiredConcepts]) }),
    limitations: Object.freeze([...value.limitations]) }) as OpportunityDefinition
}

function unavailableReason(value: OpportunityDefinition, semantic: ResolvedSemanticModel): string | undefined {
  const missingConcepts = value.requiredConcepts?.filter(concept => memberConcepts.includes(concept)) ?? []
  if (missingConcepts.length > 0) return `Missing governed member concepts: ${missingConcepts.join(', ')}`
  const unavailableMetrics = [...value.primaryMetrics, ...value.guardrailMetrics, value.rule.metric]
    .filter((metric, index, all) => all.indexOf(metric) === index)
    .filter(metric => semantic.metrics.get(metric)?.kind === 'unavailable')
  return unavailableMetrics.length > 0 ? `Unavailable semantic metrics: ${unavailableMetrics.join(', ')}` : undefined
}

/** Validate deployment definitions and return an immutable marketing model.
 * @param config Explicit governed opportunities.
 * @param semantic Existing resolved CRM semantic model.
 * @returns Immutable opportunity lookup and model-safe catalog.
 */
export function resolveMarketingModel(config: MarketingConfig, semantic: ResolvedSemanticModel): MarketingModel {
  if (!config || !Array.isArray(config.opportunities) || config.opportunities.length === 0) throw new Error('Marketing opportunities are required')
  const definitions = new Map<string, OpportunityDefinition>()
  for (const value of config.opportunities) {
    exactKeys(value, ['id', 'title', 'dataset', 'comparison', 'rule', 'primaryMetrics', 'guardrailMetrics', 'impactWeight', 'riskWeight',
      'actionTemplate', 'audienceConditions', 'audienceEstimateMetric', 'audiencePolicyId', 'requiredConcepts', 'limitations'],
    'opportunity definition')
    if (!ids.test(value.id) || !value.title.trim() || !value.actionTemplate.trim() || !value.dataset.trim()) throw new Error('Invalid opportunity definition')
    if (definitions.has(value.id)) throw new Error(`Duplicate opportunity id ${value.id}`)
    if (!comparisons.has(value.comparison)) throw new Error('Invalid opportunity comparison')
    validateRule(value.rule)
    if (!Array.isArray(value.primaryMetrics) || value.primaryMetrics.length === 0 || !Array.isArray(value.guardrailMetrics)) throw new Error('Invalid opportunity metrics')
    const referencedMetrics = [...value.primaryMetrics, ...value.guardrailMetrics, value.rule.metric]
    if (referencedMetrics.some(metric => metricDataset(semantic, metric) !== value.dataset)) throw new Error('Cross-dataset opportunity requirements')
    const dimensions = [value.rule.kind === 'growth' ? undefined : value.rule.dimension,
      ...value.audienceConditions.filter((condition): condition is DimensionAudienceCondition => condition.kind === 'dimension_value').map(condition => condition.dimension)]
      .filter((dimension): dimension is string => dimension !== undefined)
    for (const dimension of dimensions) {
      if (dimensionDataset(semantic, dimension) !== value.dataset) throw new Error('Cross-dataset opportunity requirements')
    }
    if (!Number.isFinite(value.impactWeight) || value.impactWeight < 0 || value.impactWeight > 1
      || !Number.isFinite(value.riskWeight) || value.riskWeight < 0 || value.riskWeight > 1) throw new Error('Invalid opportunity weight')
    if (!Array.isArray(value.audienceConditions)) throw new Error('Invalid audience conditions')
    value.audienceConditions.forEach(validateAudience)
    if (value.audienceEstimateMetric !== undefined && metricDataset(semantic, value.audienceEstimateMetric) !== value.dataset) {
      throw new Error('Cross-dataset audience estimate metric')
    }
    if (value.audiencePolicyId !== undefined && !ids.test(value.audiencePolicyId)) throw new Error('Invalid audience policy id')
    const hasMemberAudience = value.audienceConditions.some(condition => condition.kind === 'member_segment')
    const concepts = new Set(value.requiredConcepts ?? [])
    if (hasMemberAudience && memberConcepts.some(concept => !concepts.has(concept))) {
      throw new Error('Member opportunity requires recency, consent, spend, and identity')
    }
    if (!Array.isArray(value.limitations) || value.limitations.some(item => !item.trim())) throw new Error('Invalid opportunity limitations')
    definitions.set(value.id, freezeDefinition(value))
  }
  const catalog = Object.freeze([...definitions.values()].map((value): OpportunityCatalogItem => {
    const reason = unavailableReason(value, semantic)
    return Object.freeze({ id: value.id, title: value.title, comparison: value.comparison, available: reason === undefined,
      ...(reason === undefined ? {} : { unavailableReason: reason }), primaryMetrics: Object.freeze([...value.primaryMetrics]),
      guardrailMetrics: Object.freeze([...value.guardrailMetrics]), actionTemplate: value.actionTemplate,
      limitations: Object.freeze([...value.limitations]) })
  }))
  return Object.freeze({
    opportunityCatalog: () => catalog,
    resolveOpportunity(id: string) {
      const value = definitions.get(id)
      if (!value) throw new Error(`Unknown opportunity id ${id}`)
      return value
    },
  })
}
