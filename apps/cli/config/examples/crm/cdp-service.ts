/** Read-only CDP audience catalog used by CRM campaign planning. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque CDP tag identity. */
export type CdpTagId = Branded<'CdpTagId'>
/** Safe CDP tag projection. */
export interface CdpTagCatalogItem { id: CdpTagId; code: string; name: string; fullName: string; matchCount?: number }
/** CDP operations exposed to CRM campaign planning. */
export interface CrmCdpService {
  tagCatalog(query: string | undefined, limit: number, signal: AbortSignal): Promise<readonly CdpTagCatalogItem[]>
}

declare module '@deepseek-ai/cordis' { interface Context { crmCdp: CrmCdpService } }
