import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { CrmCdpHttpProvider, resolveCdpConfig } from '../config/examples/crm/cdp-http-provider.ts'

const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => { resolve() })))))

async function endpoint(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(handler); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing server address')
  return `http://127.0.0.1:${address.port}`
}

describe('CRM CDP HTTP provider', () => {
  it('searches active tags and returns safe bounded projections', async () => {
    let path = ''
    const url = await endpoint((request, response) => {
      path = request.url ?? ''
      response.end(JSON.stringify([
        { id: 'tag-1', code: 'recent', name: '7天有购买', fullName: '订单-7天有购买', matchCount: 645, delete: false,
          conditions: [{ private: true }] },
        { id: 'tag-2', code: 'old', name: '旧标签', delete: true },
      ]))
    })
    const config = resolveCdpConfig({ endpoint: url, allowHttp: true, allowUnauthenticated: true,
      collectionId: 'mkt_catering_loyalty', usernameEnv: 'U', passwordEnv: 'P', timeoutMs: 100,
      maxResponseBytes: 4096 }, {})
    const provider = new CrmCdpHttpProvider(config, {})
    await expect(provider.tagCatalog('购买', 10, AbortSignal.timeout(500))).resolves.toEqual([
      { id: 'tag-1', code: 'recent', name: '7天有购买', fullName: '订单-7天有购买', matchCount: 645 },
    ])
    expect(path).toBe('/api/cdp-portal/tag/mkt_catering_loyalty/list')
  })

  it('requires explicit HTTP policy', () => {
    expect(() => resolveCdpConfig({ endpoint: 'http://example.test', allowHttp: false, allowUnauthenticated: true,
      collectionId: 'mkt_catering_loyalty', usernameEnv: 'U', passwordEnv: 'P', timeoutMs: 100,
      maxResponseBytes: 4096 }, {})).toThrow(/HTTPS required/)
  })
})
