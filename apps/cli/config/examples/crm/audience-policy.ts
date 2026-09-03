/** Governed evidence-to-MA audience policy resolution. */
import type { ResolvedMaAudience } from './ma-service.ts'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { MarketingModel } from './marketing-model.ts'
import type { RecommendationV1 } from './opportunity-evaluator.ts'
import type { CampaignActivation } from './campaign-planner.ts'

/** Closed audience condition source. */
export type AudienceSource = 'tag' | 'field'
/** Closed configured audience operator. */
export type AudienceOperator = 'equals' | 'in'
/** Mandatory exclusion applied to every generated audience. */
export interface AudienceExclusion { source: AudienceSource; key: string; operator: 'equals'; value: string }
/** Deployment-owned policy for one governed opportunity. */
export interface AudiencePolicyDefinition {
  id: string
  opportunityId: string
  source: AudienceSource
  key: string
  operator: AudienceOperator
  evidenceDimension: string
  valueMap: Record<string, string>
  mandatoryExclusions: AudienceExclusion[]
  maxEstimatedSize: number
  actionIds: string[]
}
/** Complete audience-policy configuration. */
export interface AudiencePolicyConfig { policies: AudiencePolicyDefinition[] }
/** Immutable lookup by opportunity id. */
export type ResolvedAudiencePolicies = ReadonlyMap<string, Readonly<AudiencePolicyDefinition>>

const id = /^[a-z][a-z0-9_]*$/
function exact(value: object, keys: readonly string[], message: string): void {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error(message)
}

/** Resolve exact deployment policies against the governed opportunity catalog.
 * @param config Audience policy configuration.
 * @param marketing Governed marketing model.
 * @returns Immutable policy lookup.
 */
export function resolveAudiencePolicy(config: AudiencePolicyConfig, marketing: MarketingModel): ResolvedAudiencePolicies {
  exact(config, ['policies'], 'Invalid audience policy configuration keys')
  if (!Array.isArray(config.policies)) throw new Error('Invalid audience policies')
  const opportunities = new Set(marketing.opportunityCatalog().map(item => item.id))
  const result = new Map<string, Readonly<AudiencePolicyDefinition>>()
  for (const policy of config.policies) {
    exact(policy, ['id', 'opportunityId', 'source', 'key', 'operator', 'evidenceDimension', 'valueMap',
      'mandatoryExclusions', 'maxEstimatedSize', 'actionIds'], 'Invalid audience policy configuration keys')
    if (!id.test(policy.id) || !opportunities.has(policy.opportunityId)
      || marketing.resolveOpportunity(policy.opportunityId).audiencePolicyId !== policy.id) {
      throw new Error('Unknown audience policy opportunity')
    }
    if (!['tag', 'field'].includes(policy.source) || !['equals', 'in'].includes(policy.operator)) throw new Error('Invalid audience operator')
    if (!id.test(policy.key) || !id.test(policy.evidenceDimension) || Object.keys(policy.valueMap).length === 0
      || Object.values(policy.valueMap).some(value => !value.trim())) throw new Error('Invalid audience evidence mapping')
    if (!Array.isArray(policy.mandatoryExclusions) || policy.mandatoryExclusions.length === 0) throw new Error('Audience exclusion is required')
    for (const exclusion of policy.mandatoryExclusions) {
      exact(exclusion, ['source', 'key', 'operator', 'value'], 'Invalid audience exclusion keys')
      if (!['tag', 'field'].includes(exclusion.source) || exclusion.operator !== 'equals'
        || !id.test(exclusion.key) || !exclusion.value.trim()) throw new Error('Invalid audience exclusion')
    }
    if (!Number.isSafeInteger(policy.maxEstimatedSize) || policy.maxEstimatedSize <= 0
      || !Array.isArray(policy.actionIds) || policy.actionIds.length === 0) throw new Error('Invalid audience policy limits')
    if (result.has(policy.opportunityId)) throw new Error('Duplicate audience policy opportunity')
    result.set(policy.opportunityId, Object.freeze({ ...policy, valueMap: Object.freeze({ ...policy.valueMap }),
      mandatoryExclusions: Object.freeze(policy.mandatoryExclusions.map(item => Object.freeze({ ...item }))),
      actionIds: Object.freeze([...policy.actionIds]) }) as Readonly<AudiencePolicyDefinition>)
  }
  return result
}

/** Build one protocol-independent MA audience from recorded aggregate evidence.
 * @param policy Resolved governed policy.
 * @param recommendation Recorded recommendation.
 * @param planId Current campaign plan identity.
 * @param estimatedSize Optional MA count used to enforce the cap.
 * @returns Immutable resolved MA audience.
 */
export function buildMaAudience(
  policy: Readonly<AudiencePolicyDefinition>, recommendation: RecommendationV1, planId: string, estimatedSize?: number,
): ResolvedMaAudience {
  if (recommendation.opportunityId !== policy.opportunityId) throw new Error('Audience policy opportunity mismatch')
  if (estimatedSize !== undefined && estimatedSize > policy.maxEstimatedSize) throw new Error('Audience exceeds configured maximum')
  const sourceValues = recommendation.evidence.flatMap(item => item.rows.map(row => row.dimensions[policy.evidenceDimension]))
  if (sourceValues.some(value => typeof value !== 'string' && typeof value !== 'number')) throw new Error('Missing audience evidence mapping')
  const values = [...new Set(sourceValues.map(value => policy.valueMap[String(value)]))]
  if (values.length === 0 || values.some(value => value === undefined)) throw new Error('Missing audience evidence mapping')
  const all = [{ source: policy.source, key: policy.key, operator: policy.operator, values: values as string[] },
    ...policy.mandatoryExclusions.map(item => ({ source: item.source, key: item.key,
      operator: 'not_equals', values: [item.value] }))]
  return Object.freeze({ id: `aud_${planId}`, name: `CRM ${recommendation.title}`, description: recommendation.actionTemplate,
    selectType: 'CONDITION', usageType: 'CAMPAIGN',
    filter: Object.freeze({ all: Object.freeze(all.map(item => Object.freeze(item))) }) as unknown as JsonValue,
    setting: Object.freeze({ dwhType: 'MA' }), extra: Object.freeze({ planId, policyId: policy.id }) })
}

/** Build an MA audience from CDP tags validated and recorded by campaign planning.
 * @param policy Governed size and opportunity policy.
 * @param recommendation Recorded recommendation.
 * @param planId Current campaign plan identity.
 * @param activation Validated live-system selection.
 * @param estimatedSize Optional aggregate estimate.
 * @returns Immutable resolved MA audience.
 */
export function buildMaTagAudience(
  policy: Readonly<AudiencePolicyDefinition>, recommendation: RecommendationV1, planId: string,
  activation: CampaignActivation, estimatedSize?: number,
): ResolvedMaAudience {
  if (recommendation.opportunityId !== policy.opportunityId) throw new Error('Audience policy opportunity mismatch')
  if (estimatedSize !== undefined && estimatedSize > policy.maxEstimatedSize) throw new Error('Audience exceeds configured maximum')
  const all = [{ source: 'tag' as const, key: 'tag', operator: 'equals' as const, values: [activation.audienceTag.id] },
    ...activation.exclusionTags.map(item => ({ source: 'tag' as const, key: 'tag', operator: 'not_equals' as const,
      values: [item.id] }))]
  return Object.freeze({ id: `aud_${planId}`, name: `CRM ${recommendation.title}`, description: recommendation.actionTemplate,
    selectType: 'CONDITION', usageType: 'CAMPAIGN', filter: Object.freeze({ all: Object.freeze(all) }) as unknown as JsonValue,
    setting: Object.freeze({ dwhType: 'MA' }), extra: Object.freeze({ planId, policyId: policy.id }) })
}
