/**
 * dsh-zsxq — browser half. Registers the ZSXQ settings panel into the
 * web settings page (settings.section entry). Failure policy: registration
 * problems are logged, never thrown — the web shell fails the whole boot
 * when a plugin apply throws, and an external plugin must not take the GUI
 * down.
 */
// Type-only: pulls the settings-surface SlotMap merge (the 'settings.section'
// entry) and the client runtime Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ZsxqPanel } from './ZsxqPanel.tsx'

/** Required services. */
export const inject = ['slots']

/**
 * Register the ZSXQ settings page.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'zsxq-mcp',
      order: 335,
      label: () => '知识星球',
    }, ZsxqPanel))
  } catch (error) {
    console.warn('[dsh-zsxq] settings panel registration failed:', error)
  }
}
