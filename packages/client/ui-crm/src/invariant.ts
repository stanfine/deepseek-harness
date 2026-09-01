/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-crm`.
 * @module @deepseek-ai/dsh-client-ui-crm/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-crm'

/** Cordis companion plugin name. */
export const name = 'client-ui-crm-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the locale dictionaries and keyed CRM
 * toolview are registry-owned registrations whose disposal is proven by the
 * HMR-safety spec. They emit no cordis events and own no cross-plugin mutable
 * state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
