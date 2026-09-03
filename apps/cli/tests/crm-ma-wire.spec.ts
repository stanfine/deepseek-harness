import { describe, expect, it } from 'vitest'
import { compileMaAudience, compileMaCampaignSetting, compileMaFlowData } from '../config/examples/crm/ma-wire.ts'

describe('CRM MA wire compiler', () => {
  it('maps governed tags to the exact MA AudienceFilter shape', () => {
    const result = compileMaAudience({ filter: { all: [
      { source: 'tag', key: 'segment', operator: 'in', values: ['tag-1'] },
      { source: 'tag', key: 'blacklist', operator: 'not_equals', values: ['tag-black'] },
    ] } } as never)
    expect(result).toMatchObject({ filter: { filedFilter: { relation: 'and' }, tagFilter: {
      requiredTags: ['tag-1'], optionalTags: [], excludedTags: ['tag-black'],
    } }, setting: { dwhType: 'lianwei_cdp', audienceGroup: 'outside' } })
  })

  it('emits MA X6 flowData and wraps it as a FLOW campaign setting', () => {
    const flow = compileMaFlowData({ nodes: [
      { id: 'start', type: 'START', config: {} }, { id: 'audience', type: 'AUDIENCE', config: {} },
      { id: 'delivery', type: 'ACTION', config: { kind: 'ma_delivery', templateId: 'welcome', capabilityId: 'sms',
        reachField: 'Customer.basicInfo.mobile' } },
      { id: 'end', type: 'END', config: {} },
    ], edges: [
      { id: 'e1', source: 'start', target: 'audience', connectorId: 'sequence' },
      { id: 'e2', source: 'audience', target: 'delivery', connectorId: 'sequence' },
      { id: 'e3', source: 'delivery', target: 'end', connectorId: 'sequence' },
    ] }, 'aud-1' as never)
    const items = flow as unknown as { shape?: string; data?: Record<string, unknown> }[]
    expect(items.find(item => item.shape === 'AudienceNode')?.data).toMatchObject({ audienceId: 'aud-1' })
    expect(items.find(item => item.shape === 'FlowContentNode')?.data).toMatchObject({ flowContentId: 'welcome', configId: 'sms',
      reachField: 'Customer.basicInfo.mobile', limit: false })
    const setting = compileMaCampaignSetting(flow) as { type: string; flowData: string }
    expect(setting.type).toBe('FLOW')
    expect(JSON.parse(setting.flowData) as unknown).toEqual(flow)
  })
})
