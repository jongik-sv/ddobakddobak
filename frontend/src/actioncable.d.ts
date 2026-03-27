declare module '@rails/actioncable' {
  interface Subscription {
    perform(action: string, data?: Record<string, unknown>): void
    unsubscribe(): void
  }

  interface Subscriptions {
    create(
      channel: string | Record<string, unknown>,
      callbacks?: {
        connected?(): void
        disconnected?(): void
        rejected?(): void
        received?(data: unknown): void
      }
    ): Subscription
  }

  interface Consumer {
    subscriptions: Subscriptions
    disconnect(): void
  }

  function createConsumer(url?: string): Consumer
}
