/** Loopback Elasticsearch fixture for the CRM session, mounted by dsh only. */
import { createServer } from 'node:http'

export const name = 'crm-elasticsearch-fixture'

/** Provide one ephemeral endpoint and close its sockets with the plugin. */
export async function apply(ctx) {
  const server = createServer(async (request, response) => {
    let text = ''
    for await (const chunk of request) text += chunk.toString()
    const body = JSON.parse(text)
    if (!['/mkt_catering_loyalty_behavior_consumer_order/_search', '/mkt_catering_loyalty_customer/_search'].includes(request.url)) {
      response.writeHead(404)
      response.end()
      return
    }
    const filtered = body.query.bool.filter.some(filter => filter.term?.channelId === 'pos')
    const count = filtered ? 2 : 3
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({
      timed_out: false, _shards: { failed: 0 }, hits: { total: { value: count, relation: 'eq' }, hits: [] },
      aggregations: body.aggs?.earliest ? {
        earliest: { value: Date.parse('2025-02-01T00:00:00Z') },
        latest: { value: Date.parse('2025-03-31T12:00:00Z') }, missingTime: { doc_count: 0 },
      } : body.aggs?.groups ? { missingDimension: { doc_count: 0 }, groups: { sum_other_doc_count: 0, doc_count_error_upper_bound: 0,
        buckets: [{ key: 'pos', doc_count: 3, amount: { count: 3, sum: 120, avg: 40, min: 20, max: 80 } }] } }
        : body.aggs?.trend ? { trend: { buckets: [{ key_as_string: '2025-03-01', doc_count: 3,
          amount: { count: 3, sum: 120, avg: 40, min: 20, max: 80 } }] } }
        : { amount: { count, sum: filtered ? 100 : 120, avg: filtered ? 50 : 40, min: 20, max: 80 } },
    }))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  ctx.effect(() => () => new Promise((resolve, reject) => {
    server.closeAllConnections()
    server.close(error => error ? reject(error) : resolve())
  }))
  ctx.provide('crmFixtureEndpoint', `http://127.0.0.1:${server.address().port}`)
}
