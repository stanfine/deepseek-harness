import { expect, it } from 'vitest'
import { readReport } from '../src/client/report-model.ts'

it('accepts source-backed sales metadata and rejects a mismatched kind', () => {
  const data = { kind: 'sales', timeZone: '+08:00', coverage: { earliest: '2024-01-01', latest: '2025-05-10', missingTime: 0 },
    rows: [{ period: 'current', start: '2025-05-05', end: '2025-05-12', complete: false, available: true,
      amount: 1200, orders: 4, purchasers: 3, repeatPurchasers: 1, quantity: 6,
      amountPerOrder: { value: 300 }, itemsPerOrder: { value: 1.5 }, amountPerItem: { value: 200 },
      frequency: { value: 4 / 3 }, amountPerPurchaser: { value: 400 }, exactCustomers: true, missingCustomers: 0 }], warning: 'source warning' }
  expect(readReport({ crmReport: { version: 1, kind: 'sales', request: { date: '2025-05-07' }, data } }))
    .toMatchObject({ kind: 'sales', data: { rows: [{ amount: 1200 }] } })
  expect(readReport({ crmReport: { version: 1, kind: 'product', request: { date: '2025-05-07' }, data } })).toBeNull()
})

it('accepts explicit lifecycle and product unavailability', () => {
  expect(readReport({ crmReport: { version: 1, kind: 'lifecycle', request: { date: '2025-05-07' }, data: {
    kind: 'lifecycle', available: false, requiredStart: '2024-04-01', observedStart: '2024-12-01', requiredEnd: '2025-05-12', observedEnd: '2025-05-07',
  } } })).not.toBeNull()
  expect(readReport({ crmReport: { version: 1, kind: 'product', request: { date: '2025-05-07', groupBy: 'series' }, data: {
    kind: 'product', available: false, groupBy: 'series', reason: 'coverage gap',
  } } })).not.toBeNull()
})

it('rejects available reports whose rendered measures are missing', () => {
  expect(readReport({ crmReport: { version: 1, kind: 'lifecycle', request: { date: '2025-05-07' }, data: {
    kind: 'lifecycle', available: true, newPurchasers: 2, warning: 'missing cohorts',
  } } })).toBeNull()
  expect(readReport({ crmReport: { version: 1, kind: 'product', request: { date: '2025-05-07' }, data: {
    kind: 'product', available: true, groupBy: 'sku', groups: [], warning: 'missing completeness fields',
  } } })).toBeNull()
})

it('accepts only fixed, opaque Excel export metadata', () => {
  const data = { kind: 'excel', export: { id: 'A'.repeat(32), filename: 'crm-weekly-2025-05-07.xlsx', bytes: 1234,
    expiresAt: '2025-05-07T01:00:00.000Z' }, downloadUrl: `http://localhost:3000/api/crm.export?id=${'A'.repeat(32)}`,
  sheets: ['Definition', 'Sales Overview', 'Lifecycle', 'Traffic', 'Product Series', 'Product SKU', 'Recommendations'], warning: 'live source' }
  expect(readReport({ crmReport: { version: 1, kind: 'excel', request: { date: '2025-05-07' }, data } })).not.toBeNull()
  expect(readReport({ crmReport: { version: 1, kind: 'excel', request: { date: '2025-05-07' }, data: {
    ...data, export: { ...data.export, id: '../private' },
  } } })).toBeNull()
  expect(readReport({ crmReport: { version: 1, kind: 'excel', request: { date: '2025-05-07' }, data: {
    ...data, downloadUrl: 'https://example.com/private.xlsx',
  } } })).toBeNull()
})
