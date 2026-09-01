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
      const body = JSON.parse(text) as { aggs?: Record<string, unknown> }
      if (!body.aggs?.current) { response.writeHead(400); response.end(); return }
      response.end(JSON.stringify({ timed_out: false, _shards: { failed: 0 },
        hits: { total: { value: 2, relation: 'eq' }, hits: [] }, aggregations: {
          source_coverage: { value: Date.parse('2024-01-01T00:00:00Z') }, current: { doc_count: 2, m0: { value: 100 } },
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
    const result = await scaffold.ctx.tools.execute({ agent, name: 'crm_catalog', arguments: {}, callId: ToolCallId('crm-web-catalog'), signal: new AbortController().signal })
    expect(result.isError).toBe(false)
    expect((result.value as { datasets: Array<{ name: string }> }).datasets.map(dataset => dataset.name))
      .toEqual(['orders', 'members', 'order_facts', 'order_items'])
    expect(JSON.stringify(result)).not.toContain('fixture-password')
    const metricCatalog = await scaffold.ctx.tools.execute({ agent, name: 'crm_metric_catalog', arguments: {},
      callId: ToolCallId('crm-web-metrics'), signal: new AbortController().signal })
    expect((metricCatalog.value as { metrics: Array<{ id: string }> }).metrics.map(metric => metric.id)).toContain('sales_amount')
    const analysis = await scaffold.ctx.tools.execute({ agent, name: 'crm_analyze', arguments: {
      metrics: ['sales_amount'], start: '2025-01-01', end: '2025-02-01', intent: 'summary',
    }, callId: ToolCallId('crm-web-analysis'), signal: new AbortController().signal })
    expect(analysis.isError).toBe(false)
    expect(analysis.meta).toMatchObject({ crmAnalysis: { version: 1, request: { metrics: ['sales_amount'], intent: 'summary' },
      data: { version: 1, rows: [{ metrics: { sales_amount: { value: 100 } } }] } } })
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
