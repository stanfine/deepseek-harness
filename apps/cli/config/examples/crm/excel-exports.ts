/** Expiring, path-confined registry for generated CRM workbooks. */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Public workbook locator persisted in a tool result. */
export interface ExcelExport {
  id: string
  filename: string
  bytes: number
  expiresAt: string
}

interface Entry extends ExcelExport { path: string; expiresAtMs: number; timer: ReturnType<typeof setTimeout> }

/** Own generated files and expose them only by random opaque ids. */
export class ExcelExportRegistry {
  private readonly entries = new Map<string, Entry>()
  private readonly reservations = new Map<string, string>()
  private readonly root: string
  private readonly ttlMs: number
  private readonly maxFiles: number
  private readonly now: () => number

  /** Create one registry.
   * @param root Deployment-owned export directory.
   * @param ttlMs File lifetime in milliseconds.
   * @param maxFiles Maximum concurrently registered files.
   * @param now Clock injected for deterministic tests.
   */
  constructor(root: string, ttlMs: number, maxFiles: number, now: () => number = Date.now) {
    this.root = resolve(root)
    this.ttlMs = ttlMs
    this.maxFiles = maxFiles
    this.now = now
    if (dirname(this.root) === this.root) throw new Error('CRM Excel export root cannot be a filesystem root')
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || !Number.isSafeInteger(maxFiles) || maxFiles <= 0) {
      throw new Error('Invalid CRM Excel export limits')
    }
  }

  /** Reserve a private random path for one report date.
   * @param date Valid report date used only in the fixed filename.
   * @returns Opaque id, confined output path and public filename.
   */
  async reserve(date: string): Promise<{ id: string; path: string; filename: string }> {
    await this.prune()
    if (this.entries.size + this.reservations.size >= this.maxFiles) throw new Error('CRM Excel export file limit reached')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid CRM Excel report date')
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    for (let attempt = 0; attempt < 4; attempt++) {
      const id = randomBytes(24).toString('base64url')
      if (this.entries.has(id) || this.reservations.has(id)) continue
      const filename = `crm-weekly-${date}.xlsx`
      const path = join(this.root, `${id}.xlsx`)
      this.reservations.set(id, path)
      return { id, filename, path }
    }
    throw new Error('CRM Excel export id generation failed')
  }

  /** Publish a successfully generated reserved file.
   * @param reservation Value returned by reserve.
   * @returns Persistable public export metadata.
   */
  async publish(reservation: { id: string; path: string; filename: string }): Promise<ExcelExport> {
    if (resolve(reservation.path) !== join(this.root, `${reservation.id}.xlsx`)
      || !/^[A-Za-z0-9_-]{32}$/.test(reservation.id)
      || !/^crm-weekly-\d{4}-\d{2}-\d{2}\.xlsx$/.test(reservation.filename)
      || this.reservations.get(reservation.id) !== reservation.path) throw new Error('Invalid CRM Excel reservation')
    const info = await stat(reservation.path)
    if (!info.isFile() || info.size <= 0) throw new Error('CRM Excel export is empty')
    const expiresAtMs = this.now() + this.ttlMs
    const timer = setTimeout(() => {
      if (this.entries.get(reservation.id)?.expiresAtMs !== expiresAtMs) return
      this.entries.delete(reservation.id)
      void rm(reservation.path, { force: true })
    }, this.ttlMs)
    timer.unref()
    const entry: Entry = { id: reservation.id, filename: reservation.filename, path: reservation.path,
      bytes: info.size, expiresAtMs, expiresAt: new Date(expiresAtMs).toISOString(), timer }
    this.entries.set(entry.id, entry)
    this.reservations.delete(entry.id)
    return { id: entry.id, filename: entry.filename, bytes: entry.bytes, expiresAt: entry.expiresAt }
  }

  /** Release one failed reservation and remove its partial file.
   * @param reservation Value returned by reserve.
   */
  async discard(reservation: { id: string; path: string }): Promise<void> {
    if (this.reservations.get(reservation.id) !== reservation.path) return
    this.reservations.delete(reservation.id)
    await rm(reservation.path, { force: true })
  }

  /** Load one registered workbook or report its public HTTP status.
   * @param id Opaque export id from a tool result.
   * @returns Download response payload, 404 for unknown, or 410 for expired.
   */
  async read(id: string): Promise<{ status: 200; filename: string; bytes: Uint8Array } | { status: 404 | 410 }> {
    if (!/^[A-Za-z0-9_-]{32}$/.test(id)) return { status: 404 }
    const entry = this.entries.get(id)
    if (!entry) return { status: 404 }
    if (entry.expiresAtMs <= this.now()) {
      this.entries.delete(id)
      clearTimeout(entry.timer)
      await rm(entry.path, { force: true })
      return { status: 410 }
    }
    try { return { status: 200, filename: entry.filename, bytes: await readFile(entry.path) } }
    catch { return { status: 404 } }
  }

  /** Delete every owned export and wait for filesystem cleanup. */
  async dispose(): Promise<void> {
    const paths = [...this.entries.values()].map(entry => entry.path).concat([...this.reservations.values()])
    for (const entry of this.entries.values()) clearTimeout(entry.timer)
    this.entries.clear()
    this.reservations.clear()
    await Promise.all(paths.map(path => rm(path, { force: true })))
  }

  private async prune(): Promise<void> {
    const expired = [...this.entries.values()].filter(entry => entry.expiresAtMs <= this.now())
    for (const entry of expired) { this.entries.delete(entry.id); clearTimeout(entry.timer) }
    await Promise.all(expired.map(entry => rm(entry.path, { force: true })))
  }
}
