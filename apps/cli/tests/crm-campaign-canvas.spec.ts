import { describe, expect, it } from 'vitest'
import { buildSinglePathCanvas, resolveCanvasConfig } from '../config/examples/crm/campaign-canvas.ts'

function config() {
  return { nodeTypes: { entry: 'AUDIENCE_ENTRY', condition: 'CONDITION', action: 'ACTION', end: 'END' }, connectorId: 'sequence',
    actions: [
      { id: 'sms_offer', kind: 'ma_delivery', templateId: 'sms-approved', capabilityId: 'sms-capability' },
      { id: 'welcome_coupon', kind: 'loyalty_coupon', templateId: 'coupon-approved', capabilityId: 'benefit-capability' },
    ] }
}

const plan = { version: 1, planId: 'plan_abc', recommendationId: 'rec_abc', status: 'preview', readyForCreation: true,
  readinessReasons: [], audiencePreview: { conditions: [], estimatedCount: 42, unavailableReasons: [] },
  actionTemplate: 'Offer', primaryMetrics: ['sales_amount'], guardrailMetrics: ['atv'], limitations: [] }

describe('CRM campaign canvas', () => {
  it.each([
    [{ kind: 'ma_delivery', templateId: 'sms-approved' }, 'sms-capability'],
    [{ kind: 'loyalty_coupon', templateId: 'coupon-approved', capabilityId: 'benefit-capability' }, 'benefit-capability'],
  ])('generates one stable entry-condition-action-end path for %j', (action, capabilityId) => {
    const canvas = buildSinglePathCanvas(resolveCanvasConfig(config() as never), plan as never, action as never)
    expect(canvas.nodes.map(node => [node.id, node.type])).toEqual([
      ['entry_plan_abc', 'AUDIENCE_ENTRY'], ['condition_plan_abc', 'CONDITION'],
      ['action_plan_abc', 'ACTION'], ['end_plan_abc', 'END'],
    ])
    expect(canvas.edges).toEqual([
      { id: 'edge_1_plan_abc', source: 'entry_plan_abc', target: 'condition_plan_abc', connectorId: 'sequence' },
      { id: 'edge_2_plan_abc', source: 'condition_plan_abc', target: 'action_plan_abc', connectorId: 'sequence' },
      { id: 'edge_3_plan_abc', source: 'action_plan_abc', target: 'end_plan_abc', connectorId: 'sequence' },
    ])
    expect(canvas.nodes[2]?.config).toMatchObject({ capabilityId })
  })

  it('rejects non-allowlisted templates, capabilities, and arbitrary configuration keys', () => {
    const resolved = resolveCanvasConfig(config() as never)
    expect(() => buildSinglePathCanvas(resolved, plan as never, { kind: 'ma_delivery', templateId: 'other' })).toThrow(/allowlisted/)
    expect(() => buildSinglePathCanvas(resolved, plan as never,
      { kind: 'loyalty_coupon', templateId: 'coupon-approved', capabilityId: 'other' })).toThrow(/capability/)
    expect(() => resolveCanvasConfig({ ...config(), canvasJson: {} } as never)).toThrow(/configuration keys/)
  })
})
