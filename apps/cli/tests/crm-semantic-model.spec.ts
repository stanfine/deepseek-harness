import { describe, expect, it } from 'vitest'
import type { Dataset } from '../config/examples/crm/elasticsearch.ts'
import {
  resolveSemanticModel,
  type MetricDefinition,
  type SemanticConfig,
} from '../config/examples/crm/semantic-model.ts'

const datasets: Record<string, Dataset> = {
  facts: {
    index: 'crm_facts', timeField: 'private_order_date', amountField: 'private_amount', customerField: 'private_customer',
    amountMeaning: 'Configured fact amount.', dimensions: { province: 'private_province' },
    measures: { orderCount: 'private_order_count', quantity: 'private_quantity' }, previewFields: [],
  },
  items: {
    index: 'crm_items', timeField: 'private_item_date', amountField: 'private_item_amount',
    amountMeaning: 'Configured item amount.', dimensions: { series: 'private_series' },
    measures: { quantity: 'private_item_quantity' }, previewFields: [],
  },
}

function semanticConfig(): SemanticConfig {
  return {
    maxSelectedMetrics: 5, maxDimensions: 2, maxFilters: 4, maxTopN: 20, timeGrains: ['day', 'week', 'month'],
    metrics: [
      { id: 'sales_amount', name: '销售额', dataset: 'facts', kind: 'sum', field: 'amount', format: 'currency',
        description: 'Configured order amount total.', limitations: ['Refund and currency treatment require source-owner confirmation.'] },
      { id: 'order_count', name: '订单数', dataset: 'facts', kind: 'sum', field: 'orderCount', format: 'number',
        description: 'Configured order-count measure total.', limitations: [] },
      { id: 'document_count', name: '记录数', dataset: 'facts', kind: 'count', format: 'number',
        description: 'Document count.', limitations: ['Documents may not be deduplicated orders.'] },
      { id: 'purchaser_count', name: '购买人数', dataset: 'facts', kind: 'distinct_count', field: 'customer', format: 'number',
        description: 'Distinct configured purchaser identifiers.', limitations: ['Missing identifiers are excluded.'] },
      { id: 'atv', name: '客单价', dataset: 'facts', kind: 'ratio', dependencies: ['sales_amount', 'order_count'], format: 'currency',
        description: 'Sales amount per order.', limitations: ['Unavailable when order count is zero.'] },
    ],
    dimensions: [
      { id: 'day', name: '日期', dataset: 'facts', field: 'time', dataType: 'date', filters: ['equals', 'in'],
        timeGrains: ['day', 'week', 'month'], description: 'Configured order date.', limitations: [] },
      { id: 'province', name: '省份', dataset: 'facts', field: 'province', dataType: 'keyword', filters: ['equals', 'in'],
        description: 'Configured province.', limitations: [] },
    ],
  }
}

function metric(config: SemanticConfig, id: string): MetricDefinition {
  const definition = config.metrics.find(candidate => candidate.id === id)
  if (!definition) throw new Error(`Missing fixture metric ${id}`)
  return definition
}

function sumMetric(config: SemanticConfig, id: string): Extract<MetricDefinition, { kind: 'sum' }> {
  const definition = metric(config, id)
  if (definition.kind !== 'sum') throw new Error(`Fixture metric ${id} is not a sum`)
  return definition
}

function distinctCountMetric(config: SemanticConfig, id: string): Extract<MetricDefinition, { kind: 'distinct_count' }> {
  const definition = metric(config, id)
  if (definition.kind !== 'distinct_count') throw new Error(`Fixture metric ${id} is not a distinct count`)
  return definition
}

function ratioMetric(config: SemanticConfig, id: string): Extract<MetricDefinition, { kind: 'ratio' }> {
  const definition = metric(config, id)
  if (definition.kind !== 'ratio') throw new Error(`Fixture metric ${id} is not a ratio`)
  return definition
}

const limitCases: readonly [keyof Pick<SemanticConfig, 'maxSelectedMetrics' | 'maxDimensions' | 'maxFilters' | 'maxTopN'>, number][] = [
  ['maxSelectedMetrics', 0], ['maxSelectedMetrics', 6], ['maxDimensions', -1], ['maxDimensions', 3], ['maxFilters', 1.5], ['maxTopN', 0],
]

describe('CRM semantic model', () => {
  it('projects a valid catalog without configured source fields', () => {
    const model = resolveSemanticModel(semanticConfig(), datasets)
    const metrics = model.metricCatalog() as { metrics: unknown[] }
    const dimensions = model.dimensionCatalog() as { dimensions: unknown[] }

    expect(metrics).toMatchObject({
      limits: { maxSelectedMetrics: 5, maxDimensions: 2, maxFilters: 4, maxTopN: 20, timeGrains: ['day', 'week', 'month'] },
    })
    expect(metrics.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sales_amount', name: '销售额', dataset: 'facts', format: 'currency' }),
      expect.objectContaining({ id: 'atv', dependencies: ['sales_amount', 'order_count'] }),
    ]))
    expect(dimensions.dimensions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'day', dataset: 'facts', dataType: 'date', filters: ['equals', 'in'], timeGrains: ['day', 'week', 'month'] }),
    ]))
    expect(JSON.stringify([model.metricCatalog(), model.dimensionCatalog()])).not.toMatch(/private_(amount|customer|order_date|province)/)
  })

  it('does not expose mutable lookup maps through forEach', () => {
    const config = semanticConfig()
    const model = resolveSemanticModel(config, datasets)
    model.metrics.forEach((_definition, _id, map) => {
      expect(map).toBe(model.metrics)
      expect('set' in map).toBe(false)
    })

    expect(model.metrics.has('tampered')).toBe(false)
    expect(JSON.stringify(model.metricCatalog())).not.toContain('tampered')
  })

  it.each([
    ['metric', (config: SemanticConfig) => { config.metrics.push({ ...metric(config, 'sales_amount') }) }, /Duplicate metric id/],
    ['dimension', (config: SemanticConfig) => { config.dimensions.push({ ...config.dimensions[0]! }) }, /Duplicate dimension id/],
  ])('rejects duplicate %s ids', (_kind, change, error) => {
    const config = semanticConfig()
    change(config)
    expect(() => resolveSemanticModel(config, datasets)).toThrow(error)
  })

  it.each([
    ['metric dataset', (config: SemanticConfig) => { config.metrics[0] = { ...metric(config, 'sales_amount'), dataset: 'missing' } }, /Unknown metric dataset/],
    ['dimension dataset', (config: SemanticConfig) => { config.dimensions[0] = { ...config.dimensions[0]!, dataset: 'missing' } }, /Unknown dimension dataset/],
    ['sum field', (config: SemanticConfig) => { config.metrics[0] = { ...sumMetric(config, 'sales_amount'), field: 'gross' } }, /Unknown metric field/],
    ['distinct field', (config: SemanticConfig) => { config.metrics[3] = { ...distinctCountMetric(config, 'purchaser_count'), field: 'memberId' } }, /Unknown metric field/],
    ['dimension field', (config: SemanticConfig) => { config.dimensions[1] = { ...config.dimensions[1]!, field: 'channel' } }, /Unknown dimension field/],
  ])('rejects an unknown configured %s', (_subject, change, error) => {
    const config = semanticConfig()
    change(config)
    expect(() => resolveSemanticModel(config, datasets)).toThrow(error)
  })

  it('rejects ratios with missing dependencies', () => {
    const config = semanticConfig()
    config.metrics[4] = { ...ratioMetric(config, 'atv'), dependencies: ['sales_amount', 'missing'] }

    expect(() => resolveSemanticModel(config, datasets)).toThrow(/Unknown metric dependency/)
  })

  it('rejects cyclic ratio dependencies', () => {
    const config = semanticConfig()
    config.metrics.push(
      { id: 'first_ratio', name: '第一比率', dataset: 'facts', kind: 'ratio', dependencies: ['second_ratio', 'sales_amount'], format: 'number', description: 'Cycle.', limitations: [] },
      { id: 'second_ratio', name: '第二比率', dataset: 'facts', kind: 'ratio', dependencies: ['first_ratio', 'order_count'], format: 'number', description: 'Cycle.', limitations: [] },
    )

    expect(() => resolveSemanticModel(config, datasets)).toThrow(/Cyclic metric dependency/)
  })

  it('rejects ratios whose dependencies use another dataset', () => {
    const config = semanticConfig()
    config.metrics[0] = { ...sumMetric(config, 'sales_amount'), dataset: 'items', field: 'amount' }

    expect(() => resolveSemanticModel(config, datasets)).toThrow(/Incompatible metric dependency datasets/)
  })

  it('rejects ratios that depend on unavailable metrics', () => {
    const config = semanticConfig()
    config.metrics.push({ id: 'repeat_purchase', name: '复购', dataset: 'facts', kind: 'unavailable', format: 'number',
      description: 'Repeat purchase.', limitations: ['The configured source has no repeat-purchase definition.'] })
    config.metrics[4] = { ...ratioMetric(config, 'atv'), dependencies: ['sales_amount', 'repeat_purchase'] }

    expect(() => resolveSemanticModel(config, datasets)).toThrow(/Unavailable metric dependency/)
  })

  it.each(limitCases)('rejects invalid %s', (key, value) => {
    const config = semanticConfig()
    config[key] = value

    expect(() => resolveSemanticModel(config, datasets)).toThrow(new RegExp(`Invalid ${key}`))
  })

  it('requires unavailable definitions to disclose a concrete limitation', () => {
    const config = semanticConfig()
    config.metrics.push({ id: 'repeat_purchase', name: '复购', dataset: 'facts', kind: 'unavailable', format: 'number',
      description: 'Repeat purchase.', limitations: [] })
    expect(() => resolveSemanticModel(config, datasets)).toThrow(/Unavailable metric requires a concrete limitation/)

    config.metrics[5] = { ...config.metrics[5]!, limitations: ['The configured source has no repeat-purchase definition.'] }
    const catalog = resolveSemanticModel(config, datasets).metricCatalog() as { metrics: unknown[] }
    expect(catalog.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'repeat_purchase', available: false, limitations: ['The configured source has no repeat-purchase definition.'] }),
    ]))
  })
})
