import { KNOWN_SESSION_EVENT_TYPES, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { CrmCampaignIdempotencyKey, CrmCampaignPlanId } from '../src/index.ts'
import { describe, expect, it } from 'vitest'

describe('CRM campaign event vocabulary', () => {
  it('records every progress event as immutable log-only state', () => {
    const session = Session.create(SessionId('crm-events'))
    const key = 'draft-key' as CrmCampaignIdempotencyKey
    session.append('crm-campaign/draft-started', { key, planId: 'plan-id' as CrmCampaignPlanId, inputDigest: 'digest' })
    session.append('crm-campaign/draft-failed', { key, stage: 'validation', code: 'FAILED' })
    expect(session.events.map(event => event.type)).toEqual(['crm-campaign/draft-started', 'crm-campaign/draft-failed'])
    expect(Object.isFrozen(session.events[0]?.data)).toBe(true)
    expect(KNOWN_SESSION_EVENT_TYPES.has('crm-campaign/draft-started')).toBe(true)
  })
})
