/** Closed CRM marketing tool policy contracts. */
import { describe, expect, it } from 'vitest'
import { crmCampaignPlanParameters, crmCampaignPreExecute } from '../config/examples/crm/crm-tools.ts'

describe('CRM marketing tools', () => {
  it('prepares an MA-native audience without requiring CDP tag ids', () => {
    expect(Object.keys(crmCampaignPlanParameters)).toEqual([
      'recommendationId', 'groupId', 'categoryId', 'contentId',
    ])
  })

  it('asks for host approval only at the external MA write', () => {
    expect(crmCampaignPreExecute('crm_campaign_plan')).toBeUndefined()
    expect(crmCampaignPreExecute('crm_campaign_status')).toBeUndefined()
    expect(crmCampaignPreExecute('crm_campaign_results')).toBeUndefined()
    expect(crmCampaignPreExecute('crm_campaign_create_draft')).toEqual({
      kind: 'ask', reason: 'Create the reviewed audience and inactive campaign draft in MA?',
    })
  })
})
