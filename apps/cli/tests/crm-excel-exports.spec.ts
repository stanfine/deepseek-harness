import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { ExcelExportRegistry } from '../config/examples/crm/excel-exports.ts'

describe('CRM Excel export registry', () => {
  it('publishes opaque downloads, expires them, and confines reservations', async () => {
    let now = Date.parse('2025-05-07T00:00:00Z')
    const root = await mkdtemp(join(tmpdir(), 'dsh-crm-export-'))
    const registry = new ExcelExportRegistry(root, 1000, 1, () => now)
    const reservation = await registry.reserve('2025-05-07')
    expect(reservation.id).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(reservation.path.startsWith(`${root}/`)).toBe(true)
    await expect(registry.reserve('2025-05-07')).rejects.toThrow(/limit/)
    await writeFile(reservation.path, 'xlsx-fixture')
    const exported = await registry.publish(reservation)
    expect(exported).toMatchObject({ filename: 'crm-weekly-2025-05-07.xlsx', bytes: 12 })
    expect(await registry.read('../private')).toEqual({ status: 404 })
    const found = await registry.read(exported.id)
    expect(found.status).toBe(200)
    if (found.status === 200) expect(Buffer.from(found.bytes).toString()).toBe('xlsx-fixture')
    now += 1001
    expect(await registry.read(exported.id)).toEqual({ status: 410 })
    await expect(readFile(reservation.path)).rejects.toThrow()
    await registry.dispose()
  })

  it('releases failed reservations without consuming the file limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-crm-export-'))
    const registry = new ExcelExportRegistry(root, 1000, 1)
    const failed = await registry.reserve('2025-05-07')
    await writeFile(failed.path, 'partial')
    await registry.discard(failed)
    await expect(registry.reserve('2025-05-08')).resolves.toMatchObject({ filename: 'crm-weekly-2025-05-08.xlsx' })
    await registry.dispose()
  })

  it('deletes a published file when its timer expires without another registry call', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-crm-export-'))
    const registry = new ExcelExportRegistry(root, 20, 1)
    const reservation = await registry.reserve('2025-05-07')
    await writeFile(reservation.path, 'xlsx')
    await registry.publish(reservation)
    await new Promise(resolve => setTimeout(resolve, 50))
    await expect(readFile(reservation.path)).rejects.toThrow()
    await registry.dispose()
  })
})
