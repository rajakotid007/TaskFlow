import { useSyncExternalStore } from 'react'
import { createConsumer, type Consumer, type Subscription } from '@rails/actioncable'
import type { QueryClient } from '@tanstack/react-query'

/**
 * Real-time updates. The server broadcasts `{type, task_id}` on every task
 * event; we invalidate the affected queries and let TanStack Query refetch
 * server truth. While the socket is down, queries poll instead (see
 * usePollInterval), so the console never depends on WebSockets.
 */
export type LiveStatus = 'connecting' | 'connected' | 'disconnected'

let status: LiveStatus = 'connecting'
const listeners = new Set<() => void>()

function setStatus(next: LiveStatus) {
  if (status === next) return
  status = next
  listeners.forEach((l) => l())
}

export function useLiveStatus() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => status,
  )
}

/** Polling cadence: frequent when the socket is down, a slow safety net otherwise. */
export function usePollInterval() {
  return useLiveStatus() === 'connected' ? 30_000 : 4_000
}

export interface LiveMessage {
  type: string
  task_id: number
  event_id: number
  at: string
}

function cableUrl() {
  const configured = import.meta.env.VITE_CABLE_URL as string | undefined
  if (configured) return configured
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/cable`
}

let consumer: Consumer | null = null
let subscription: Subscription | null = null

export function connectLive(queryClient: QueryClient, onMessage?: (msg: LiveMessage) => void) {
  if (subscription) return () => {}
  consumer = createConsumer(cableUrl())
  subscription = consumer.subscriptions.create('OperationsChannel', {
    connected: () => {
      setStatus('connected')
      // Catch up on anything missed while disconnected.
      queryClient.invalidateQueries()
    },
    disconnected: () => setStatus('disconnected'),
    rejected: () => setStatus('disconnected'),
    received: (msg: LiveMessage) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task', msg.task_id] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['routing-attempts'] })
      queryClient.invalidateQueries({ queryKey: ['events'] })
      queryClient.invalidateQueries({ queryKey: ['contributors'] })
      queryClient.invalidateQueries({ queryKey: ['simulation'] })
      onMessage?.(msg)
    },
  })
  return () => {
    subscription?.unsubscribe()
    consumer?.disconnect()
    subscription = null
    consumer = null
    setStatus('connecting')
  }
}
