// Observe existing saves for presentation only. Preserve their result/rejection.
export async function withSaveMotion<T extends { error: unknown }>(save: PromiseLike<T>): Promise<T> {
  const id = crypto.randomUUID()
  const signal = (state: string) => window.dispatchEvent(new CustomEvent('nilli-save-motion', { detail: { id, state } }))
  signal('saving')
  try {
    const result = await save
    signal(result.error ? 'failed' : 'saved')
    return result
  } catch (error) {
    signal('failed')
    throw error
  }
}
