/** Session-backed CRM campaign plan preparation. */
import { createHash } from 'node:crypto'
import type { Session } from '@deepseek-ai/dsh-session'
import { recommendationIdFor, type AnalyzeOpportunity, type OpportunityRequest,
  type RecommendationEvidence, type RecommendationV1 } from './opportunity-evaluator.ts'
import type { AudienceCondition, MarketingModel, OpportunityDefinition } from './marketing-model.ts'

/** Aggregate-only audience estimate used before MA materialization. */
export interface CampaignAudiencePreview {
  conditions: readonly AudienceCondition[]
  estimatedCount?: number
  unavailableReasons: readonly string[]
}

/** Versioned preview prepared from one recorded recommendation. */
export interface CampaignPlanResultV1 {
  version: 1
  planId: string
  recommendationId: string
  status: 'preview'
  readyForCreation: boolean
  readinessReasons: readonly string[]
  audiencePreview: CampaignAudiencePreview
  actionTemplate: string
  primaryMetrics: readonly string[]
  guardrailMetrics: readonly string[]
  limitations: readonly string[]
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function candidate(meta: unknown, id: string): { request: OpportunityRequest; value: RecommendationV1 } | undefined {
  const root = record(meta)?.crmRecommendations
  const envelope = record(root)
  const data = record(envelope?.data)
  const request = record(envelope?.request)
  if (envelope?.version !== 1 || data?.version !== 1 || !request || !Array.isArray(data.recommendations)) return undefined
  const value = data.recommendations.find(item => record(item)?.recommendationId === id)
  if (!record(value) || typeof value.opportunityId !== 'string' || !Array.isArray(value.evidence)) return undefined
  return { request: request as unknown as OpportunityRequest, value: value as unknown as RecommendationV1 }
}

/** Resolve a recommendation from the current session log.
 * @param session Current session.
 * @param recommendationId Opaque recommendation identity.
 * @returns Valid recorded recommendation.
 */
export function findRecommendation(session: Session, recommendationId: string): RecommendationV1 {
  const matches = session.events.flatMap((event) => {
    if (event.type !== 'tool/result' || event.data.message.content[0]?.type !== 'tool-result'
      || event.data.message.content[0].isError) return []
    const found = candidate(event.data.meta, recommendationId)
    return found === undefined ? [] : [found]
  })
  if (matches.length === 0) throw new Error('Recommendation was not found in the current session')
  const serialized = new Set(matches.map(match => JSON.stringify(match.value)))
  if (serialized.size > 1) throw new Error('Conflicting recommendation records in current session')
  const found = matches[0]!
  if (recommendationIdFor(found.value.opportunityId, found.request, found.value.evidence) !== recommendationId) {
    throw new Error('Recommendation digest mismatch')
  }
  return found.value
}

function triggeringValues(definition: OpportunityDefinition, evidence: RecommendationEvidence): string[] {
  const { rule } = definition
  if (rule.kind === 'growth') return []
  if (rule.kind === 'decline') return evidence.rows.filter(row => -row.metrics[rule.metric]!.changeRatio! >= rule.threshold)
    .map(row => String(row.dimensions[rule.dimension!]))
  const values = evidence.rows.map(row => row.metrics[rule.metric]!.value!)
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  return evidence.rows.filter((row) => {
    const ratio = row.metrics[rule.metric]!.value! / average
    return rule.kind === 'above_average' ? ratio >= 1 + rule.threshold : ratio <= 1 - rule.threshold
  }).map(row => String(row.dimensions[rule.dimension]))
}

/** Recompute a campaign-plan identity when validating persisted metadata.
 * @param recommendationId Source recommendation identity.
 * @param audience Aggregate audience preview.
 * @returns Stable opaque plan identity.
 */
export function campaignPlanIdFor(recommendationId: string, audience: CampaignAudiencePreview): string {
  return `plan_${createHash('sha256').update(JSON.stringify({ version: 1, recommendationId, audience })).digest('base64url')}`
}

/** Prepare one governed campaign preview.
 * @param model Governed marketing model.
 * @param recommendation Recorded recommendation.
 * @param analyze Aggregate semantic analysis callback.
 * @param signal Caller cancellation signal.
 * @returns Campaign preview.
 */
export function createCampaignPlan(
  model: MarketingModel, recommendation: RecommendationV1, analyze: AnalyzeOpportunity, signal: AbortSignal,
): Promise<CampaignPlanResultV1> {
  return createPlan(model, recommendation, analyze, signal)
}

async function createPlan(
  model: MarketingModel, recommendation: RecommendationV1, analyze: AnalyzeOpportunity, signal: AbortSignal,
): Promise<CampaignPlanResultV1> {
  const definition = model.resolveOpportunity(recommendation.opportunityId)
  const reasons: string[] = []
  let estimatedCount: number | undefined
  if (definition.audienceConditions.length === 0) reasons.push('No governed audience condition is configured')
  else if (definition.audienceConditions.some(condition => condition.kind === 'member_segment')) {
    reasons.push('Member audience concepts are unavailable')
  } else {
    const condition = definition.audienceConditions[0]!
    if (condition.kind !== 'dimension_value') throw new Error('Unsupported audience condition')
    const values = triggeringValues(definition, recommendation.evidence[0]!)
    if (values.length === 0) reasons.push('No governed audience values were supported by the evidence')
    else {
      const result = await analyze({ metrics: ['purchaser_count'], filters: [{ dimension: condition.dimension, operator: 'in', values }],
        start: recommendation.evidence[0]!.request.start, end: recommendation.evidence[0]!.request.end,
        intent: 'summary', limit: 1 }, signal)
      const value = result.rows[0]?.metrics.purchaser_count?.value
      if (value === null || value === undefined || !result.completeness.complete) reasons.push('Aggregate audience estimate is unavailable')
      else estimatedCount = value
    }
  }
  const audiencePreview = Object.freeze({ conditions: Object.freeze(definition.audienceConditions.map(item => Object.freeze({ ...item }))),
    ...(estimatedCount === undefined ? {} : { estimatedCount }), unavailableReasons: Object.freeze([...reasons]) })
  return Object.freeze({ version: 1, planId: campaignPlanIdFor(recommendation.recommendationId, audiencePreview),
    recommendationId: recommendation.recommendationId, status: 'preview', readyForCreation: reasons.length === 0,
    readinessReasons: Object.freeze(reasons), audiencePreview, actionTemplate: definition.actionTemplate,
    primaryMetrics: Object.freeze([...definition.primaryMetrics]), guardrailMetrics: Object.freeze([...definition.guardrailMetrics]),
    limitations: Object.freeze([...definition.limitations]) })
}
