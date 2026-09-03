/** Deterministic CRM opportunity evaluation over aggregate semantic evidence. */
import { createHash } from 'node:crypto'
import type { AnalysisRequest } from './analysis-planner.ts'
import { CRM_ANALYSIS_MAX_BYTES, type AnalysisRow, type SemanticAnalysisResultV1 } from './semantic-analysis.ts'
import type { MarketingModel, OpportunityComparison, OpportunityDefinition } from './marketing-model.ts'

/** Closed period request for marketing opportunity evaluation. */
export interface OpportunityRequest {
  start: string
  end: string
  comparison: OpportunityComparison
  opportunityIds?: string[]
}

/** Aggregate evidence retained for one recommendation. */
export type RecommendationEvidence = Pick<SemanticAnalysisResultV1,
  'request' | 'columns' | 'rows' | 'coverage' | 'completeness' | 'warnings'>
/** One unavailable configured opportunity. */
export interface UnavailableOpportunity { opportunityId: string; reason: string }
/** Deterministic recommendation prepared from aggregate evidence. */
export interface RecommendationV1 {
  recommendationId: string
  opportunityId: string
  score: number
  priority: 1 | 2 | 3
  title: string
  actionTemplate: string
  evidence: readonly RecommendationEvidence[]
  primaryMetrics: readonly string[]
  guardrailMetrics: readonly string[]
  limitations: readonly string[]
}
/** Versioned result persisted by the recommendation tool. */
export interface RecommendationResultV1 {
  version: 1
  request: OpportunityRequest
  recommendations: readonly RecommendationV1[]
  unavailable: readonly UnavailableOpportunity[]
}
/** Semantic analysis callback owned by the CRM tool plugin. */
export type AnalyzeOpportunity = (request: AnalysisRequest, signal: AbortSignal) => Promise<SemanticAnalysisResultV1>

function validateRequest(request: OpportunityRequest): void {
  if (!request || typeof request !== 'object' || Object.keys(request).some(key => !['start', 'end', 'comparison', 'opportunityIds'].includes(key))) {
    throw new Error('Unknown opportunity request argument')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.start) || !/^\d{4}-\d{2}-\d{2}$/.test(request.end)
    || request.start >= request.end) throw new Error('Invalid opportunity date range')
  if (!['previous_period', 'prior_year'].includes(request.comparison)) throw new Error('Invalid opportunity comparison')
  if (request.opportunityIds !== undefined && (!Array.isArray(request.opportunityIds) || request.opportunityIds.length === 0
    || request.opportunityIds.length > 20 || request.opportunityIds.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(id))
    || new Set(request.opportunityIds).size !== request.opportunityIds.length)) throw new Error('Invalid opportunity ids')
}

function analysisRequest(definition: OpportunityDefinition, request: OpportunityRequest): AnalysisRequest {
  const metrics = [...new Set([...definition.primaryMetrics, ...definition.guardrailMetrics, definition.rule.metric])]
  const dimension = definition.rule.kind === 'growth' ? undefined : definition.rule.dimension
  return { metrics, ...(dimension === undefined ? {} : { dimensions: [dimension] }), start: request.start, end: request.end,
    intent: 'comparison', comparison: request.comparison, limit: 20 }
}

function validateEvidence(definition: OpportunityDefinition, result: SemanticAnalysisResultV1): void {
  if (!result.completeness.complete || result.completeness.missingMetricValues > 0) throw new Error('Incomplete opportunity evidence')
  if (!result.coverage.current.available || !result.coverage.comparison?.available) throw new Error('Unavailable opportunity evidence coverage')
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > CRM_ANALYSIS_MAX_BYTES) throw new Error('Opportunity evidence exceeds byte limit')
  if (result.rows.length > 20) throw new Error('Opportunity evidence exceeds row limit')
  for (const row of result.rows) {
    const metric = row.metrics[definition.rule.metric]
    if (!metric) throw new Error(`Missing rule metric ${definition.rule.metric}`)
    const needsComparison = definition.rule.kind === 'growth' || definition.rule.kind === 'decline'
    const missingComparison = metric.comparisonValue === null || metric.comparisonValue === undefined
      || metric.changeRatio === null || metric.changeRatio === undefined
    if (metric.value === null || needsComparison && missingComparison) {
      throw new Error(`Missing rule metric value ${definition.rule.metric}`)
    }
  }
}

function peerAverage(rows: readonly AnalysisRow[], metric: string): number {
  const values = rows.map(row => row.metrics[metric]?.value)
  if (values.some(value => value === null || value === undefined) || values.length === 0) throw new Error(`Missing rule metric value ${metric}`)
  return (values as number[]).reduce((sum, value) => sum + value, 0) / values.length
}

function breachStrength(definition: OpportunityDefinition, rows: readonly AnalysisRow[]): number {
  const { rule } = definition
  if (rule.kind === 'growth' || rule.kind === 'decline') {
    return Math.max(0, ...rows.map((row) => {
      const change = row.metrics[rule.metric]!.changeRatio!
      const magnitude = rule.kind === 'growth' ? change : -change
      return (magnitude - rule.threshold) / rule.threshold
    }))
  }
  const average = peerAverage(rows, rule.metric)
  if (average === 0) return 0
  return Math.max(0, ...rows.map((row) => {
    const ratio = rule.kind === 'above_average'
      ? row.metrics[rule.metric]!.value! / average - 1
      : 1 - row.metrics[rule.metric]!.value! / average
    return (ratio - rule.threshold) / rule.threshold
  }))
}

function evidence(result: SemanticAnalysisResultV1): RecommendationEvidence {
  return Object.freeze({ request: result.request, columns: result.columns, rows: result.rows, coverage: result.coverage,
    completeness: result.completeness, warnings: result.warnings })
}

/** Recompute the opaque identity used to detect altered persisted recommendations.
 * @param opportunityId Governed opportunity identity.
 * @param request Normalized recommendation request.
 * @param records Persisted aggregate evidence.
 * @returns Stable opaque recommendation identity.
 */
export function recommendationIdFor(
  opportunityId: string, request: OpportunityRequest, records: readonly RecommendationEvidence[],
): string {
  return `rec_${createHash('sha256').update(JSON.stringify({ version: 1, opportunityId, request, evidence: records })).digest('base64url')}`
}

/** Evaluate selected governed opportunities without allowing arbitrary rules or queries.
 * @param model Resolved governed opportunity model.
 * @param request Closed date and comparison request.
 * @param analyze Aggregate semantic analysis callback.
 * @param signal Caller cancellation signal.
 * @returns Deterministically ordered recommendations and unavailable candidates.
 */
export async function evaluateOpportunities(
  model: MarketingModel, request: OpportunityRequest, analyze: AnalyzeOpportunity, signal: AbortSignal,
): Promise<RecommendationResultV1> {
  validateRequest(request)
  const selected = request.opportunityIds ?? model.opportunityCatalog().map(item => item.id)
  const catalog = new Map(model.opportunityCatalog().map(item => [item.id, item]))
  const unavailable: UnavailableOpportunity[] = []
  const available: OpportunityDefinition[] = []
  for (const opportunityId of selected) {
    const item = catalog.get(opportunityId)
    if (!item) throw new Error(`Unknown opportunity id ${opportunityId}`)
    if (!item.available) unavailable.push({ opportunityId, reason: item.unavailableReason ?? 'Opportunity unavailable' })
    else {
      const definition = model.resolveOpportunity(opportunityId)
      if (definition.comparison !== request.comparison) throw new Error(`Opportunity ${opportunityId} requires ${definition.comparison}`)
      available.push(definition)
    }
  }
  const datasets = new Set(available.map(item => item.dataset))
  if (datasets.size > 1) throw new Error('Selected opportunities span multiple datasets')
  const candidates: Omit<RecommendationV1, 'priority'>[] = []
  for (const definition of available) {
    signal.throwIfAborted()
    const result = await analyze(analysisRequest(definition, request), signal)
    validateEvidence(definition, result)
    const strength = breachStrength(definition, result.rows)
    if (strength <= 0) continue
    const records = Object.freeze([evidence(result)])
    const score = Math.round(strength * definition.impactWeight * (1 - definition.riskWeight) * 1000) / 1000
    candidates.push(Object.freeze({ recommendationId: recommendationIdFor(definition.id, request, records), opportunityId: definition.id,
      score, title: definition.title, actionTemplate: definition.actionTemplate, evidence: records,
      primaryMetrics: Object.freeze([...definition.primaryMetrics]), guardrailMetrics: Object.freeze([...definition.guardrailMetrics]),
      limitations: Object.freeze([...definition.limitations]) }))
  }
  candidates.sort((left, right) => right.score - left.score || left.opportunityId.localeCompare(right.opportunityId))
  const chosen = candidates.slice(0, 3).map((item, index) => Object.freeze({ ...item, priority: index + 1 as 1 | 2 | 3 }))
  return Object.freeze({ version: 1, request: Object.freeze({ ...request,
    ...(request.opportunityIds === undefined ? {}
      : { opportunityIds: Object.freeze([...request.opportunityIds]) }) }) as OpportunityRequest,
  recommendations: Object.freeze(chosen), unavailable: Object.freeze(unavailable.map(item => Object.freeze(item))) })
}
