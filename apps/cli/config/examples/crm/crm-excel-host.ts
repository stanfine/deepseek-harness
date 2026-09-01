/** Web Host owner for CRM Excel files and the authenticated download route. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ExcelExportRegistry, type ExcelExport } from './excel-exports.ts'

/** Cordis plugin identity. */
export const name = 'crm-excel-host'
/** The route mounts only after the Host connection service exists. */
export const inject = ['connection']
/** Host-owned renderer and file-lifetime configuration. */
export const Config = z.object({
  artifactToolModule: z.string().required(), exportRoot: z.string().required(),
  ttlMs: z.number().required(), maxFiles: z.number().required(),
})

/** Agent-facing publication service backed by one Host route. */
export interface CrmExcelExports {
  artifactToolModule: string
  reserve(date: string): Promise<{ id: string; path: string; filename: string }>
  publish(reservation: { id: string; path: string; filename: string }): Promise<ExcelExport>
  discard(reservation: { id: string; path: string }): Promise<void>
}

interface ConnectionFetch {
  register(route: { path: string; methods: readonly ('GET' | 'HEAD')[]; fetch(request: Request): Promise<Response> }): () => void
}

function connectionOf(ctx: Context): { fetch: ConnectionFetch } {
  return Reflect.get(ctx, 'connection') as { fetch: ConnectionFetch }
}

/** Provide one export registry and route for every CRM Agent session on this Host.
 * @param ctx Host plugin context.
 * @param config Explicit renderer and storage limits.
 */
export function apply(ctx: Context, config: { artifactToolModule: string; exportRoot: string; ttlMs: number; maxFiles: number }): void {
  if (config.artifactToolModule.length === 0 || config.exportRoot.length === 0) throw new Error('Invalid CRM Excel Host configuration')
  const registry = new ExcelExportRegistry(config.exportRoot, config.ttlMs, config.maxFiles)
  const service: CrmExcelExports = {
    artifactToolModule: config.artifactToolModule,
    reserve: date => registry.reserve(date),
    publish: reservation => registry.publish(reservation),
    discard: reservation => registry.discard(reservation),
  }
  ctx.provide('crmExcelExports' as never, service as never)
  ctx.effect(() => () => registry.dispose())
  ctx.effect(() => connectionOf(ctx).fetch.register({
    path: '/api/crm.export', methods: ['GET', 'HEAD'],
    async fetch(request) {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      const found = await registry.read(id)
      if (found.status !== 200) return new Response(found.status === 410 ? 'CRM Excel export expired' : 'CRM Excel export not found', { status: found.status })
      const headers = { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${found.filename}"`, 'cache-control': 'private, no-store' }
      const buffer = new ArrayBuffer(found.bytes.byteLength)
      new Uint8Array(buffer).set(found.bytes)
      return new Response(request.method === 'HEAD' ? null : new Blob([buffer]), { status: 200, headers })
    },
  }))
}
