/** CRM slot registrations leave with their owning plugin fiber. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import * as plugin from '../src/client/index.ts'

it('registers CRM only and removes its slot and dictionaries on disposal', async () => {
  const ctx = new Context()
  const slots = new SlotRegistry(ctx)
  slots.register({ name: 'root', children: { 'tool.call.toolview': { kind: 'keyed', scope: 'session' } } } as never, () => null)
  const unregister = vi.fn()
  ctx.provide('locale', { register: () => unregister })
  try {
    const fiber = ctx.plugin(plugin)
    await fiber
    expect(slots.entries('tool.call.toolview').map(entry => entry.options.key)).toEqual([
      'crm_query', 'crm_report_periods', 'crm_sales_report', 'crm_lifecycle_report', 'crm_product_report', 'crm_export_weekly_excel',
      'crm_analyze', 'crm_drilldown',
    ])
    await fiber.dispose()
    expect(slots.entries('tool.call.toolview')).toHaveLength(0)
    expect(unregister).toHaveBeenCalledOnce()
  } finally { await ctx.fiber.dispose() }
})
