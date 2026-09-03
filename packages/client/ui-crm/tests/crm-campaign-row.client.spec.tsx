// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { CrmCampaignRow } from '../src/client/CrmCampaignRow.tsx'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '../../locale/src/locales/zh.ts'

afterEach(cleanup)
function props(meta: object): Parameters<typeof CrmCampaignRow>[0] {
  return { block: { kind: 'tool-result', callId: 'campaign', call: { name: 'crm_campaign_create_draft', argsRaw: '{}' },
    content: [{ type: 'text', text: 'raw-campaign' }], isError: false, meta }, t: makeTranslate(zh, commonZh),
  useInput: (select: (state: { draft: string }) => unknown) => select({ draft: '' }),
  inputActions: { setDraft: vi.fn(), submit: vi.fn() } } as unknown as Parameters<typeof CrmCampaignRow>[0]
}

it('renders an inactive draft with opaque external ids', () => {
  render(<CrmCampaignRow {...props({ crmCampaign: { version: 1, kind: 'draft', data: { version: 1,
    planId: 'plan_abc', idempotencyKey: 'draft_abc', campaignId: 'campaign-1', audienceId: 'audience-1',
    status: 'inactive', created: true, warnings: [] } } })} />)
  expect(screen.getByText('MA 未启动活动草稿已创建')).toBeTruthy()
  expect(screen.getByText(/campaign-1/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /启动|发送|审批/ })).toBeNull()
})

it('renders the reviewed MA selections and campaign canvas', () => {
  render(<CrmCampaignRow {...props({ crmCampaignPlan: { version: 1, data: { version: 1, planId: 'plan_abc',
    recommendationId: 'rec_abc', status: 'preview', readyForCreation: true, readinessReasons: [],
    audiencePreview: { conditions: [{ kind: 'dimension_value' }], estimatedCount: 42, unavailableReasons: [] },
    actionTemplate: '发送配置模板', primaryMetrics: ['sales_amount'], guardrailMetrics: ['atv'], limitations: [],
    activation: { group: { id: 'group', name: '营销活动', kind: 'group', enabled: true },
      category: { id: 'category', name: '分类', kind: 'category', enabled: true },
      content: { id: 'content', name: '推荐商品', kind: 'content', enabled: true, flowNodeId: 'MESSAGE' } },
    canvas: { nodes: [{ id: 'entry', type: 'START', config: {} }, { id: 'audience', type: 'AUDIENCE', config: {} },
      { id: 'action', type: 'ACTION', config: {} }, { id: 'end', type: 'END', config: {} }],
    edges: [{ id: 'e1', source: 'entry', target: 'audience', connectorId: 'sequence' },
      { id: 'e2', source: 'audience', target: 'action', connectorId: 'sequence' },
      { id: 'e3', source: 'action', target: 'end', connectorId: 'sequence' }] } } } })} />)
  expect(screen.getByText('活动画布')).toBeTruthy()
  expect(screen.getByText('START → AUDIENCE → ACTION → END')).toBeTruthy()
  expect(screen.getByText(/营销活动.*分类.*推荐商品/)).toBeTruthy()
})

it('falls back to raw output for an active campaign draft', () => {
  render(<CrmCampaignRow {...props({ crmCampaign: { version: 1, kind: 'draft', data: { version: 1,
    planId: 'plan_abc', idempotencyKey: 'draft_abc', campaignId: 'campaign-1', audienceId: 'audience-1',
    status: 'active', created: true, warnings: [] } } })} />)
  expect(screen.getByText('活动结果无法展示，保留原始结果。')).toBeTruthy()
})
