import { describe, expect, it } from 'vitest'
import { buildMaAudience, resolveAudiencePolicy } from '../config/examples/crm/audience-policy.ts'

const marketing = { opportunityCatalog: () => [{ id: 'channel_optimization', available: true }],
  resolveOpportunity: () => ({ id: 'channel_optimization', audiencePolicyId: 'channel_policy',
    audienceConditions: [{ kind: 'dimension_value', dimension: 'channel' }] }) }

function config() {
  return { policies: [{ id: 'channel_policy', opportunityId: 'channel_optimization', source: 'tag', key: 'preferred_channel',
    operator: 'in', evidenceDimension: 'channel', valueMap: { store: 'STORE', online: 'ONLINE' },
    mandatoryExclusions: [{ source: 'tag', key: 'marketing_consent', operator: 'equals', value: 'false' }],
    maxEstimatedSize: 1000, actionIds: ['sms_offer'] }] }
}

const recommendation = { recommendationId: 'rec_x', opportunityId: 'channel_optimization', score: 1, priority: 1,
  title: 'Optimize channel', actionTemplate: 'Review channel', primaryMetrics: ['sales_amount'], guardrailMetrics: ['atv'],
  limitations: [], evidence: [{ request: {}, columns: {}, rows: [
    { dimensions: { channel: 'store' }, metrics: { sales_amount: { value: 70, comparisonValue: 100, changeRatio: -0.3 } } },
  ], coverage: {}, completeness: {}, warnings: [] }] }

describe('CRM audience policy', () => {
  it('resolves exact configured mappings and builds an immutable MA audience', () => {
    const policies = resolveAudiencePolicy(config() as never, marketing as never)
    const audience = buildMaAudience(policies.get('channel_optimization')!, recommendation as never, 'plan_1')
    expect(audience).toMatchObject({ id: 'aud_plan_1', selectType: 'CONDITION', usageType: 'CAMPAIGN', filter: { all: [
      { source: 'tag', key: 'preferred_channel', operator: 'in', values: ['STORE'] },
      { source: 'tag', key: 'marketing_consent', operator: 'not_equals', values: ['false'] },
    ] }, extra: { planId: 'plan_1', policyId: 'channel_policy' } })
    expect(Object.isFrozen(audience)).toBe(true)
  })

  it('accepts deployed MA field paths in field-backed policies', () => {
    const configured = config()
    configured.policies[0] = { ...configured.policies[0]!, source: 'field', key: 'registerChannel.channelId' }
    expect(resolveAudiencePolicy(configured as never, marketing as never).get('channel_optimization')?.key)
      .toBe('registerChannel.channelId')
  })

  it.each([
    ['unknown keys', () => ({ ...config(), script: 'x' }), /configuration keys/],
    ['unknown opportunity', () => ({ policies: [{ ...config().policies[0]!, opportunityId: 'missing' }] }), /opportunity/],
    ['arbitrary operator', () => ({ policies: [{ ...config().policies[0]!, operator: 'script' }] }), /operator/],
    ['missing evidence mapping', () => ({ policies: [{ ...config().policies[0]!, valueMap: {} }] }), /mapping/],
    ['missing exclusions', () => ({ policies: [{ ...config().policies[0]!, mandatoryExclusions: [] }] }), /exclusion/],
  ])('rejects %s', (_label, mutate, error) => {
    expect(() => resolveAudiencePolicy(mutate() as never, marketing as never)).toThrow(error)
  })

  it('refuses unmapped evidence and an audience estimate above its cap', () => {
    const policy = resolveAudiencePolicy(config() as never, marketing as never).get('channel_optimization')!
    expect(() => buildMaAudience(policy, { ...recommendation, evidence: [{ ...recommendation.evidence[0]!, rows: [
      { dimensions: { channel: 'unknown' }, metrics: {} },
    ] }] } as never, 'plan_1')).toThrow(/mapping/)
    expect(() => buildMaAudience(policy, recommendation as never, 'plan_1', 1001)).toThrow(/maximum/)
  })
})
