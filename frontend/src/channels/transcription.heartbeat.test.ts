import { describe, it, expect, vi } from 'vitest'
import { sendHeartbeat } from './transcription'

describe('sendHeartbeat', () => {
  it("subscription.perform('heartbeat') 호출", () => {
    const perform = vi.fn()
    sendHeartbeat({ perform } as unknown as import('@rails/actioncable').Subscription)
    expect(perform).toHaveBeenCalledWith('heartbeat', {})
  })
})
