import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import * as Host from '../config/examples/crm/crm-excel-host.ts'

describe('CRM Excel Host', () => {
  it('owns one route and registry shared by multiple Agent contexts', async () => {
    const ctx = new Context()
    let route: { fetch(request: Request): Promise<Response> } | undefined
    const disposeRoute = vi.fn()
    const register = vi.fn((value: { fetch(request: Request): Promise<Response> }) => { route = value; return disposeRoute })
    ctx.provide('connection', { fetch: { register } } as never)
    const root = await mkdtemp(join(tmpdir(), 'dsh-crm-host-'))
    try {
      const fiber = ctx.plugin(Host, { artifactToolModule: 'fixture-module', exportRoot: root, ttlMs: 1000, maxFiles: 2 })
      await fiber
      const first = Reflect.get(ctx.extend({ agent: 'first' }), 'crmExcelExports') as Host.CrmExcelExports
      const second = Reflect.get(ctx.extend({ agent: 'second' }), 'crmExcelExports') as Host.CrmExcelExports
      expect(first).toBe(second)
      expect(register).toHaveBeenCalledOnce()
      const reservation = await first.reserve('2025-05-07')
      await writeFile(reservation.path, 'xlsx')
      const exported = await second.publish(reservation)
      const response = await route!.fetch(new Request(`http://localhost/api/crm.export?id=${exported.id}`))
      expect(response.status).toBe(200)
      expect(response.headers.get('content-disposition')).toContain('crm-weekly-2025-05-07.xlsx')
      await fiber.dispose()
      expect(disposeRoute).toHaveBeenCalledOnce()
    } finally { await ctx.fiber.dispose() }
  })
})
