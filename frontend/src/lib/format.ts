import { serverNow } from '../api/client'

export function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

export function secondsSince(iso: string, now = serverNow()) {
  return (now - new Date(iso).getTime()) / 1000
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const timeWithSeconds = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso))
export const formatTime = (iso: string) => timeWithSeconds.format(new Date(iso))
export const formatDate = (iso: string) => dateOnly.format(new Date(`${iso}T00:00:00`))

export function formatRelative(iso: string, now = serverNow()) {
  const s = secondsSince(iso, now)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

const short = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
export const formatShort = (iso: string) => short.format(new Date(iso))

/** Today's date in the operator's own time zone, as YYYY-MM-DD. */
export function localDateString(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
