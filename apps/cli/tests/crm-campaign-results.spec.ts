/** Aggregate campaign result collection behavior. */
import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { CrmMaService } from '../config/examples/crm/ma-service.ts'
import { collectCampaignResults, findRecordedCampaign } from '../config/examples/crm/campaign-results.ts'

function session() {
  const value = Session.create(SessionId('campaign-results'))
  value.append('crm-campaign/draft-started', { key: 'draft_key' as never, planId: 'plan_abc' as never, inputDigest: 'digest' })
  value.append('crm-campaign/draft-created', { key: 'draft_key' as never, audienceId: 'audience-1' as never,
    campaignId: 'campaign-1' as never, status: 'inactive' })
  return value
}
function ma(): CrmMaService {
  return { countAudience: vi.fn(), createAudience: vi.fn(), findAudienceByBusinessKey: vi.fn(), validateCanvas: vi.fn(),
    createCampaignDraft: vi.fn(), findCampaignByBusinessKey: vi.fn(), activationCatalog: vi.fn(async () => []),
    campaignStatus: vi.fn(async (id: Parameters<CrmMaService['campaignStatus']>[0]) => (
      { id, status: 'DRAFT', started: false, archived: false })),
    reachSummary: vi.fn(async () => ({ reachPeople: 12, channels: [{ channel: 'SMS', count: 12 }] })) }
}

describe('campaign aggregate results', () => {
  it('uses only the current-session campaign id and reports absent attribution', async () => {
    const result = await collectCampaignResults(session(), 'plan_abc', { start: '2026-09-01', end: '2026-09-08' },
      { holdoutConfigured: false }, ma(), undefined, new AbortController().signal)
    expect(result).toMatchObject({ campaignId: 'campaign-1', ma: { available: true, data: { reachPeople: 12 } },
      loyalty: { available: false }, conversion: { available: false }, incrementality: { available: false } })
    expect(JSON.stringify(result)).not.toMatch(/customer|phone|email/i)
  })

  it('fails closed for cross-session ids and invalid periods', async () => {
    expect(() => findRecordedCampaign(Session.create(SessionId('empty')), 'plan_abc')).toThrow(/current session/)
    await expect(collectCampaignResults(session(), 'plan_abc', { start: '2026-09-08', end: '2026-09-01' },
      { holdoutConfigured: false }, ma(), undefined, new AbortController().signal)).rejects.toThrow(/period/)
  })

  it('preserves partial MA failure without leaking provider errors', async () => {
    const service = ma()
    service.reachSummary = vi.fn(async () => { throw new Error('remote body secret') })
    const result = await collectCampaignResults(session(), 'plan_abc', { start: '2026-09-01', end: '2026-09-08' },
      { holdoutConfigured: false }, service, undefined, new AbortController().signal)
    expect(result.ma).toEqual({ available: false, reason: 'Source aggregate is unavailable' })
    expect(JSON.stringify(result)).not.toContain('secret')
  })
})
