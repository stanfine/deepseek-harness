import { describe, expect, it } from 'vitest'
import { resolveMarketingModel, type MarketingConfig, type OpportunityDefinition } from '../config/examples/crm/marketing-model.ts'
import { resolveSemanticModel, type SemanticConfig } from '../config/examples/crm/semantic-model.ts'
import type { Dataset } from '../config/examples/crm/elasticsearch.ts'

const datasets: Record<string, Dataset> = {
  orders: { index: 'private', timeField: 'private_time', amountField: 'private_amount', customerField: 'private_customer',
    amountMeaning: 'Gross amount.', dimensions: { channel: 'private_channel', store: 'private_store' },
    measures: { quantity: 'private_quantity' }, previewFields: [] },
}

function semanticModel() {
  const semantic: SemanticConfig = {
    maxSelectedMetrics: 5, maxDimensions: 2, maxFilters: 10, maxTopN: 20, maxFilterValues: 20,
    maxInputChars: 128, maxRequestBytes: 8192, timeGrains: ['day', 'week', 'month'],
    metrics: [
      { id: 'sales_amount', name: 'Sales', dataset: 'orders', kind: 'sum', field: 'amount', format: 'currency', description: 'Sales.', limitations: [] },
      { id: 'order_count', name: 'Orders', dataset: 'orders', kind: 'count', format: 'number', description: 'Orders.', limitations: [] },
      { id: 'quantity', name: 'Items', dataset: 'orders', kind: 'sum', field: 'quantity', format: 'number', description: 'Items.', limitations: [] },
      { id: 'atv', name: 'ATV', dataset: 'orders', kind: 'ratio', dependencies: ['sales_amount', 'order_count'], format: 'currency', description: 'ATV.', limitations: [] },
      { id: 'items_per_order', name: 'Items/order', dataset: 'orders', kind: 'ratio', dependencies: ['quantity', 'order_count'], format: 'decimal', description: 'Items/order.', limitations: [] },
      { id: 'repeat_purchase', name: 'Repeat', dataset: 'orders', kind: 'unavailable', format: 'number', description: 'Repeat.', limitations: ['No definition.'] },
      { id: 'lifecycle', name: 'Lifecycle', dataset: 'orders', kind: 'unavailable', format: 'number', description: 'Lifecycle.', limitations: ['No definition.'] },
    ],
    dimensions: [
      { id: 'channel', name: 'Channel', dataset: 'orders', field: 'channel', dataType: 'keyword', filters: ['equals', 'in'], description: 'Channel.', limitations: [] },
      { id: 'store', name: 'Store', dataset: 'orders', field: 'store', dataType: 'keyword', filters: ['equals', 'in'], description: 'Store.', limitations: [] },
    ],
  }
  return resolveSemanticModel(semantic, datasets)
}

function opportunity(overrides: Partial<OpportunityDefinition> = {}): OpportunityDefinition {
  return { id: 'channel_optimization', title: 'Optimize channels', dataset: 'orders', comparison: 'previous_period',
    rule: { kind: 'decline', metric: 'sales_amount', dimension: 'channel', threshold: 0.1 },
    primaryMetrics: ['sales_amount'], guardrailMetrics: ['atv'], impactWeight: 0.8, riskWeight: 0.2,
    actionTemplate: 'Review channel mix.', audienceConditions: [{ kind: 'dimension_value', dimension: 'channel' }],
    limitations: ['Aggregate evidence only.'], ...overrides }
}

function config(): MarketingConfig {
  return { opportunities: [
    opportunity(),
    opportunity({ id: 'store_improvement', title: 'Improve stores', rule: { kind: 'below_average', metric: 'sales_amount', dimension: 'store', threshold: 0.15 }, actionTemplate: 'Review store performance.' }),
    opportunity({ id: 'atv_growth', title: 'Grow ATV', rule: { kind: 'growth', metric: 'atv', threshold: 0.05 }, primaryMetrics: ['atv'], audienceConditions: [] }),
    opportunity({ id: 'items_per_order_growth', title: 'Grow basket size', rule: { kind: 'growth', metric: 'items_per_order', threshold: 0.05 }, primaryMetrics: ['items_per_order'], audienceConditions: [] }),
    opportunity({ id: 'reactivation', title: 'Reactivate customers', rule: { kind: 'growth', metric: 'lifecycle', threshold: 0.05 }, primaryMetrics: ['lifecycle'],
      requiredConcepts: ['recency', 'consent', 'spend', 'identity'], audienceConditions: [{ kind: 'member_segment', segment: 'inactive' }] }),
    opportunity({ id: 'repurchase_growth', title: 'Grow repurchase', rule: { kind: 'growth', metric: 'repeat_purchase', threshold: 0.05 }, primaryMetrics: ['repeat_purchase'],
      requiredConcepts: ['recency', 'consent', 'spend', 'identity'], audienceConditions: [{ kind: 'member_segment', segment: 'recent_buyer' }] }),
  ] }
}

describe('CRM marketing model', () => {
  it('publishes six governed opportunities without source fields', () => {
    const model = resolveMarketingModel(config(), semanticModel())
    expect(model.opportunityCatalog()).toHaveLength(6)
    expect(model.opportunityCatalog().find(item => item.id === 'channel_optimization')).toMatchObject({ available: true })
    const reactivation = model.opportunityCatalog().find(item => item.id === 'reactivation')
    expect(reactivation?.available).toBe(false)
    expect(reactivation?.unavailableReason).toContain('recency')
    expect(JSON.stringify(model.opportunityCatalog())).not.toMatch(/private_|field|index/)
    expect(Object.isFrozen(model.resolveOpportunity('channel_optimization'))).toBe(true)
  })

  it.each([
    ['duplicate ids', (value: MarketingConfig) => value.opportunities.push({ ...value.opportunities[0]! }), /Duplicate opportunity id/],
    ['unknown metric', (value: MarketingConfig) => { value.opportunities[0] = opportunity({ primaryMetrics: ['missing'] }) }, /Unknown opportunity metric/],
    ['unknown dimension', (value: MarketingConfig) => { value.opportunities[0] = opportunity({ rule: { kind: 'decline', metric: 'sales_amount', dimension: 'missing', threshold: 0.1 } }) }, /Unknown opportunity dimension/],
    ['unsupported comparison', (value: MarketingConfig) => { (value.opportunities[0] as { comparison: string }).comparison = 'rolling' }, /Invalid opportunity comparison/],
    ['unknown audience condition', (value: MarketingConfig) => { (value.opportunities[0]!.audienceConditions[0] as { kind: string }).kind = 'script' }, /Invalid audience condition/],
    ['out-of-range threshold', (value: MarketingConfig) => { value.opportunities[0] = opportunity({ rule: { kind: 'growth', metric: 'sales_amount', threshold: 2 } }) }, /Invalid opportunity threshold/],
  ])('rejects %s', (_label, mutate, error) => {
    const value = config(); mutate(value)
    expect(() => resolveMarketingModel(value, semanticModel())).toThrow(error)
  })

  it('rejects cross-dataset requirements and extra rule keys', () => {
    const value = config()
    value.opportunities[0] = opportunity({ rule: { kind: 'growth', metric: 'sales_amount', threshold: 0.1, dimension: 'channel' } as never })
    expect(() => resolveMarketingModel(value, semanticModel())).toThrow(/Invalid opportunity rule keys/)
  })

  it('rejects an executable member opportunity without governed member concepts', () => {
    const value = config()
    value.opportunities[4] = opportunity({ id: 'reactivation', requiredConcepts: [], audienceConditions: [{ kind: 'member_segment', segment: 'inactive' }] })
    expect(() => resolveMarketingModel(value, semanticModel())).toThrow(/Member opportunity requires recency, consent, spend, and identity/)
  })
})
