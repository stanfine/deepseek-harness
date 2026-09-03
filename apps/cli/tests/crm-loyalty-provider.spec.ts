import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { CrmLoyaltyHttpProvider, resolveLoyaltyConfig } from '../config/examples/crm/loyalty-http-provider.ts'

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
  return resolveLoyaltyConfig({ endpoint: url, allowHttp: true, allowUnauthenticated: true, tenantId: 'mkt', buCode: 'catering',
    usernameEnv: 'LOYALTY_USER', passwordEnv: 'LOYALTY_PASSWORD', timeoutMs: 100, maxResponseBytes: 1024,
    couponTemplateIds: ['coupon-1'] }, {})
}

describe('CRM LOYALTY HTTP provider', () => {
  it('reads only allowlisted coupon templates and aggregate summaries', async () => {
    const paths: string[] = []
    const url = await endpoint((request, response) => {
      paths.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      if (paths.length === 1) response.end(JSON.stringify({ id: 'coupon-1', name: 'Welcome', status: 'ENABLED' }))
      else response.end('12')
    })
    const provider = new CrmLoyaltyHttpProvider(config(url), {})
    await expect(provider.couponTemplate('coupon-1' as never, AbortSignal.timeout(500)))
      .resolves.toEqual({ id: 'coupon-1', name: 'Welcome', status: 'ENABLED' })
    await expect(provider.participationSummary({ activityId: 'activity-1', start: '2026-08-01', end: '2026-09-01' },
      AbortSignal.timeout(500))).resolves.toEqual({ count: 12 })
    expect(paths).toEqual(['/api/loyalty-coupon/mkt/catering/coupon_template/coupon-1',
      '/api/loyalty-activity/mkt/catering/activity-record/count?activityId=activity-1&startDate=2026-08-01&endDate=2026-09-01'])
    await expect(provider.couponTemplate('unlisted' as never, AbortSignal.timeout(500))).rejects.toThrow(/allowlisted/)
  })

  it('redacts remote failures and enforces bounded responses', async () => {
    const failing = await endpoint((_request, response) => { response.statusCode = 500; response.end('customer private detail') })
    await expect(new CrmLoyaltyHttpProvider(config(failing), {}).couponTemplate('coupon-1' as never, AbortSignal.timeout(500)))
      .rejects.toThrow(/^LOYALTY HTTP 500$/)
    const oversized = await endpoint((_request, response) => { response.end(JSON.stringify({ value: 'x'.repeat(2000) })) })
    await expect(new CrmLoyaltyHttpProvider(config(oversized), {}).couponTemplate('coupon-1' as never, AbortSignal.timeout(500)))
      .rejects.toThrow(/byte limit/)
  })
})
