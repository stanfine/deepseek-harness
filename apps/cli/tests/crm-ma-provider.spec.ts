import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { CrmMaHttpProvider, resolveMaConfig } from '../config/examples/crm/ma-http-provider.ts'

const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => { resolve() })))))

async function endpoint(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(handler); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing server address')
  return `http://127.0.0.1:${address.port}`
}

function config(url: string) {
  return resolveMaConfig({ endpoint: url, allowHttp: true, allowUnauthenticated: true, tenantId: 'mkt', buCode: 'catering',
    usernameEnv: 'MA_USER', passwordEnv: 'MA_PASSWORD', timeoutMs: 100, maxResponseBytes: 1024 }, {})
}

describe('CRM MA HTTP provider', () => {
  it('maps governed audience count and creation to exact tenant paths', async () => {
    const calls: { method?: string; url?: string; body: string }[] = []
    const url = await endpoint((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        calls.push({ ...(request.method === undefined ? {} : { method: request.method }),
          ...(request.url === undefined ? {} : { url: request.url }), body: Buffer.concat(chunks).toString() })
        response.setHeader('content-type', 'application/json')
        response.end(calls.length === 1 ? '42' : JSON.stringify({ id: 'aud-1', name: 'Test audience' }))
      })
    })
    const provider = new CrmMaHttpProvider(config(url), {})
    const spec = { id: 'aud-plan', name: 'Test audience', description: 'Governed test', selectType: 'CONDITION',
      usageType: 'CAMPAIGN', filter: { and: [{ field: 'tag', operator: 'eq', value: 'vip' }] }, setting: {}, extra: {} }
    await expect(provider.countAudience(spec, AbortSignal.timeout(500))).resolves.toBe(42)
    await expect(provider.createAudience(spec, 'key-1', AbortSignal.timeout(500))).resolves.toEqual({ id: 'aud-1', name: 'Test audience' })
    expect(calls.map(call => [call.method, call.url])).toEqual([
      ['POST', '/api/ma-manage/mkt/catering/audience/count-customers'],
      ['POST', '/api/ma-manage/mkt/catering/audience'],
    ])
    expect(JSON.parse(calls[1]!.body)).toMatchObject({ id: 'aud-plan', own: true, extra: { businessKey: 'key-1' } })
  })

  it('requires explicit HTTP and unauthenticated policies', () => {
    expect(() => resolveMaConfig({ endpoint: 'http://example.test', allowHttp: false, allowUnauthenticated: true,
      tenantId: 'mkt', buCode: 'catering', usernameEnv: 'U', passwordEnv: 'P', timeoutMs: 10, maxResponseBytes: 10 }, {}))
      .toThrow(/HTTPS required/)
    expect(() => resolveMaConfig({ endpoint: 'https://example.test', allowHttp: false, allowUnauthenticated: false,
      tenantId: 'mkt', buCode: 'catering', usernameEnv: 'U', passwordEnv: 'P', timeoutMs: 10, maxResponseBytes: 10 }, {}))
      .toThrow(/credentials/i)
  })

  it('reconciles by bounded catalog projections and filters business keys locally', async () => {
    const paths: string[] = []
    const url = await endpoint((request, response) => {
      paths.push(request.url ?? '')
      response.end(JSON.stringify(request.url?.includes('/audience/')
        ? [{ id: 'aud-1', name: 'Audience', extra: { businessKey: 'key-1' } }]
        : [{ id: 'campaign-1', name: 'Campaign', status: 'DRAFT', extra: { businessKey: 'key-1' } }]))
    })
    const provider = new CrmMaHttpProvider(config(url), {})
    await expect(provider.findAudienceByBusinessKey('key-1', AbortSignal.timeout(500)))
      .resolves.toMatchObject({ id: 'aud-1' })
    await expect(provider.findCampaignByBusinessKey('key-1', AbortSignal.timeout(500)))
      .resolves.toMatchObject({ id: 'campaign-1', status: 'DRAFT' })
    expect(paths).toEqual(['/api/ma-manage/mkt/catering/audience/list?proj=id,name,extra',
      '/api/ma-manage/mkt/catering/campaign/list?proj=id,name,status,extra'])
  })

  it('redacts remote bodies and enforces response and timeout limits', async () => {
    const failing = await endpoint((_request, response) => { response.statusCode = 500; response.end('private remote detail') })
    await expect(new CrmMaHttpProvider(config(failing), {}).campaignStatus('campaign-1' as never, AbortSignal.timeout(500)))
      .rejects.toThrow(/^MA HTTP 500$/)
    const oversized = await endpoint((_request, response) => { response.end(JSON.stringify({ value: 'x'.repeat(2000) })) })
    await expect(new CrmMaHttpProvider(config(oversized), {}).campaignStatus('campaign-1' as never, AbortSignal.timeout(500)))
      .rejects.toThrow(/byte limit/)
    const hanging = await endpoint(() => {})
    await expect(new CrmMaHttpProvider(config(hanging), {}).campaignStatus('campaign-1' as never, AbortSignal.timeout(500)))
      .rejects.toThrow(/cancelled or timed out/)
  })
})
