/** The actual Web composition mounts the CRM preset without coding tools. */
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold } from './scaffold.ts'

it('mounts the CRM example through the Web session controller', async () => {
  const server = createServer((request, response) => {
    void (async () => {
      let text = ''; for await (const chunk of request) text += String(chunk)
      const body = JSON.parse(text) as { aggs?: { current?: { aggs?: { d0?: { terms?: { field?: string } } & { aggs?: {
        d1?: { terms?: { field?: string } }
      } } } } } }
      if (!body.aggs?.current) { response.writeHead(400); response.end(); return }
      const groupedField = body.aggs.current.aggs?.d0?.terms?.field
      const nestedField = body.aggs.current.aggs?.d0?.aggs?.d1?.terms?.field
      const group = (key: string, amount: number, count: number) => ({ key, doc_count: count, m0: { value: amount } })
      const window = (groups?: Array<{ key: string; doc_count: number }>) => groups === undefined
        ? { doc_count: 4, m0: { value: 100 } }
        : { doc_count: groups.reduce((total, item) => total + item.doc_count, 0),
          d0: { sum_other_doc_count: 1, doc_count_error_upper_bound: 0, buckets: groups }, d0_missing: { doc_count: 0 } }
      const nested = (amounts: [number, number]) => [{ key: 'pos', doc_count: 3,
        d1: { sum_other_doc_count: 1, doc_count_error_upper_bound: 0,
          buckets: [group('S-001', amounts[0], 2), group('S-002', amounts[1], 1)] }, d1_missing: { doc_count: 0 } }]
      const currentGroups = nestedField === 'store.storeCode' ? nested([60, 20]) : groupedField === 'store.storeCode'
        ? [group('S-001', 60, 2), group('S-002', 20, 1)]
        : groupedField === 'channelId' ? [group('pos', 80, 3), group('online', 20, 1)] : undefined
      const comparisonGroups = nestedField === 'store.storeCode' ? nested([40, 10]) : groupedField === 'store.storeCode'
        ? [group('S-001', 40, 2), group('S-002', 10, 1)]
        : groupedField === 'channelId' ? [group('pos', 50, 2), group('online', 25, 1)] : undefined
      response.end(JSON.stringify({ timed_out: false, _shards: { failed: 0 },
        hits: { total: { value: 2, relation: 'eq' }, hits: [] }, aggregations: {
          source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') }, current: window(currentGroups),
          comparison: window(comparisonGroups),
        } }))
    })().catch(() => { response.writeHead(500); response.end() })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  vi.stubEnv('DSH_CRM_ES_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  vi.stubEnv('DSH_CRM_ALLOW_HTTP', 'true')
  vi.stubEnv('DSH_CRM_ES_USERNAME', 'fixture-user')
  vi.stubEnv('DSH_CRM_ES_PASSWORD', 'fixture-password')
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  try {
    scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('../../cli/config/examples/crm/cordis.yml', import.meta.url)),
      agentPresets: { default: 'crm', roots: [{ path: fileURLToPath(new URL('../../cli/config/examples/crm/presets', import.meta.url)), trust: 'system' }] },
    })
    const page = await scaffold.hostFetch('/')
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('@deepseek-ai/dsh-client-ui-crm')
    const created = await scaffold.ctx.sessionController.create({ cwd: scaffold.workspaceCwd, agentPreset: 'crm' })
    const agent = scaffold.ctx.agents.get(created.sessionId)
    if (!agent) throw new Error('CRM session has no Agent')
    expect(created.agentPreset).toBe('crm')
    const names = scaffold.ctx.tools.schemas(agent).map(tool => tool.name)
    expect(names).toContain('crm_query')
    expect(names).toContain('crm_catalog')
    expect(names).toContain('crm_sales_report')
    expect(names).toEqual(expect.arrayContaining(['crm_metric_catalog', 'crm_dimension_catalog', 'crm_analyze', 'crm_drilldown']))
    expect(names).not.toContain('bash')
    expect(names).not.toContain('str_replace_editor')
    const prompt = (await scaffold.ctx.systemPrompt.assemble({ scope: agent })).sections.map(section => section.text).join('\n')
    expect(prompt).toContain('crm_query 只用于标准周报或标准月报 Skill 中声明的旧固定流程')
    expect(prompt).toContain('临时走势、份额、排行、对比和下钻不得调用 crm_query')
    expect(prompt).toContain('crm_analyze 或 crm_drilldown')
    const result = await scaffold.ctx.tools.execute({ agent, name: 'crm_catalog', arguments: {}, callId: ToolCallId('crm-web-catalog'), signal: new AbortController().signal })
    expect(result.isError).toBe(false)
    expect((result.value as { datasets: Array<{ name: string }> }).datasets.map(dataset => dataset.name))
      .toEqual(['orders', 'members', 'order_facts', 'order_items'])
    expect(JSON.stringify(result)).not.toContain('fixture-password')
    const metricCatalog = await scaffold.ctx.tools.execute({ agent, name: 'crm_metric_catalog', arguments: {},
      callId: ToolCallId('crm-web-metrics'), signal: new AbortController().signal })
    const catalogMetrics = (metricCatalog.value as { metrics: Array<{ id: string; dataset: string; limitations: string[] }> }).metrics
    expect(catalogMetrics.map(metric => metric.id)).toContain('sales_amount')
    for (const id of ['atv', 'items_per_order', 'frequency', 'amount_per_purchaser']) {
      const limitations = catalogMetrics.find(metric => metric.id === id)?.limitations.join(' ') ?? ''
      expect(limitations, id).toMatch(/订单文档唯一性/)
    }
    expect(catalogMetrics.find(metric => metric.id === 'atv')?.limitations.join(' ')).toMatch(/退款.*取消.*币种/)
    expect(catalogMetrics.find(metric => metric.id === 'items_per_order')?.limitations.join(' ')).toMatch(/件数口径和退货处理/)
    expect(catalogMetrics.find(metric => metric.id === 'frequency')?.limitations.join(' ')).toMatch(/购买者标识/)
    expect(catalogMetrics.find(metric => metric.id === 'amount_per_purchaser')?.limitations.join(' ')).toMatch(/购买者标识/)
    const dimensionCatalog = await scaffold.ctx.tools.execute({ agent, name: 'crm_dimension_catalog', arguments: {},
      callId: ToolCallId('crm-web-dimensions'), signal: new AbortController().signal })
    const catalogDimensions = (dimensionCatalog.value as { dimensions: Array<{ dataset: string }> }).dimensions
    for (const dimension of catalogDimensions) {
      expect(catalogMetrics.some(metric => metric.dataset === dimension.dataset && metric.id !== 'repeat_purchase'
        && !['lifecycle', 'traffic_conversion', 'campaign_attribution', 'target_completion', 'cost'].includes(metric.id)),
      `dimension dataset ${dimension.dataset}`).toBe(true)
    }
    const analysis = await scaffold.ctx.tools.execute({ agent, name: 'crm_analyze', arguments: {
      metrics: ['sales_amount', 'order_count', 'atv'], dimensions: ['channel'], start: '2025-01-01', end: '2025-02-01',
      comparison: 'previous_period', intent: 'comparison', limit: 10,
    }, callId: ToolCallId('crm-web-analysis'), signal: new AbortController().signal })
    expect(analysis.isError).toBe(false)
    expect(analysis.meta).toMatchObject({ crmAnalysis: { version: 1,
      request: { metrics: ['sales_amount', 'order_count', 'atv'], dimensions: ['channel'], comparison: 'previous_period' },
      data: { version: 1, rows: [{ dimensions: { channel: 'pos' } }, { dimensions: { channel: 'online' } }],
        completeness: { complete: false }, warnings: [expect.stringContaining('outside the returned terms buckets')] } } })
    type AnalysisColumns = { crmAnalysis: { data: { columns: {
      metrics: Array<{ id: string; limitations: string[] }>
    } } } }
    const resultColumns = (analysis.meta as AnalysisColumns)
      .crmAnalysis.data.columns.metrics
    expect(resultColumns.find(metric => metric.id === 'atv')?.limitations.join(' ')).toMatch(/订单文档唯一性.*退款.*币种/)
    const drilldown = await scaffold.ctx.tools.execute({ agent, name: 'crm_drilldown', arguments: {
      metrics: ['sales_amount', 'order_count', 'atv'], dimensions: ['channel'], drilldownDimension: 'store',
      parentFilters: [{ dimension: 'channel', values: ['pos'] }], start: '2025-01-01', end: '2025-02-01',
      comparison: 'previous_period', intent: 'comparison', limit: 10,
    }, callId: ToolCallId('crm-web-drilldown'), signal: new AbortController().signal })
    expect(drilldown.isError, JSON.stringify(drilldown)).toBe(false)
    expect(drilldown.meta).toMatchObject({ crmAnalysis: { version: 1,
      request: { metrics: ['sales_amount', 'order_count', 'atv'], dimensions: ['channel', 'store'],
        filters: [{ dimension: 'channel', operator: 'in', values: ['pos'] }] } } })
    expect((drilldown.meta as { crmAnalysis: { data: { rows: Array<{ dimensions: Record<string, string> }> } } })
      .crmAnalysis.data.rows.map(row => row.dimensions)).toEqual([
      { channel: 'pos', store: 'S-001' }, { channel: 'pos', store: 'S-002' },
    ])
    const skill = await scaffold.ctx.tools.execute({ agent, name: 'skill', arguments: { name: 'beauty-crm-monthly' }, callId: ToolCallId('crm-web-skill'), signal: new AbortController().signal })
    expect(skill.isError).toBe(false)
    expect(JSON.stringify(skill)).toContain('crm_query')
    expect(JSON.stringify(skill)).toContain('crm_analyze')
    expect(JSON.stringify(skill)).toContain('coverage')
    const weeklySkill = await scaffold.ctx.tools.execute({ agent, name: 'skill', arguments: { name: 'beauty-crm-weekly' }, callId: ToolCallId('crm-web-weekly-skill'), signal: new AbortController().signal })
    expect(weeklySkill.isError).toBe(false)
    expect(JSON.stringify(weeklySkill)).toContain('crm_sales_report')
    expect(JSON.stringify(weeklySkill)).toContain('crm_metric_catalog')
  } finally {
    await scaffold?.close()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
    vi.unstubAllEnvs()
  }
}, 60_000)
