/** The actual Web composition mounts the CRM preset without coding tools. */
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold } from './scaffold.ts'

it('mounts the CRM example through the Web session controller', async () => {
  vi.stubEnv('DSH_CRM_ES_URL', 'http://127.0.0.1:9200')
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
    expect(names).not.toContain('bash')
    expect(names).not.toContain('str_replace_editor')
    const result = await scaffold.ctx.tools.execute({ agent, name: 'crm_catalog', arguments: {}, callId: ToolCallId('crm-web-catalog'), signal: new AbortController().signal })
    expect(result.isError).toBe(false)
    expect((result.value as { datasets: Array<{ name: string }> }).datasets.map(dataset => dataset.name))
      .toEqual(['orders', 'members', 'order_facts', 'order_items'])
    expect(JSON.stringify(result)).not.toContain('fixture-password')
    const skill = await scaffold.ctx.tools.execute({ agent, name: 'skill', arguments: { name: 'beauty-crm-monthly' }, callId: ToolCallId('crm-web-skill'), signal: new AbortController().signal })
    expect(skill.isError).toBe(false)
    expect(JSON.stringify(skill)).toContain('crm_query')
    const weeklySkill = await scaffold.ctx.tools.execute({ agent, name: 'skill', arguments: { name: 'beauty-crm-weekly' }, callId: ToolCallId('crm-web-weekly-skill'), signal: new AbortController().signal })
    expect(weeklySkill.isError).toBe(false)
    expect(JSON.stringify(weeklySkill)).toContain('crm_sales_report')
  } finally {
    await scaffold?.close()
    vi.unstubAllEnvs()
  }
}, 60_000)
