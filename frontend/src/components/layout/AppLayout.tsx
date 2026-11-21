import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Activity, FlaskConical, LayoutDashboard, ListTodo, Menu, Moon, Plus, Radar, Sun, Users, Workflow, X } from 'lucide-react'
import { connectLive, useLiveStatus } from '../../lib/live'
import { useSimulationStatus } from '../../api/hooks'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/tasks', label: 'Tasks', icon: ListTodo },
  { to: '/tasks/new', label: 'Create task', icon: Plus },
  { to: '/routing', label: 'Routing operations', icon: Radar },
  { to: '/contributors', label: 'Contributors', icon: Users },
  { to: '/activity', label: 'Activity history', icon: Activity },
]

function LiveIndicator() {
  const status = useLiveStatus()
  const meta = {
    connected: { label: 'Live', cls: 'bg-emerald-500', title: 'Receiving real-time updates' },
    connecting: { label: 'Connecting', cls: 'bg-amber-500', title: 'Connecting to real-time updates; polling meanwhile' },
    disconnected: { label: 'Polling', cls: 'bg-amber-500', title: 'Real-time connection lost — refreshing every few seconds' },
  }[status]
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400" title={meta.title} data-testid="live-status">
      <span className={clsx('size-2 rounded-full', meta.cls, status !== 'connected' && 'animate-pulse-dot')} aria-hidden />
      {meta.label}
    </span>
  )
}

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('taskflow-theme') === 'dark'
    } catch {
      return false
    }
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem('taskflow-theme', dark ? 'dark' : 'light')
    } catch {
      // Storage unavailable; the preference just won't persist.
    }
  }, [dark])
  return [dark, setDark] as const
}

export function AppLayout() {
  const queryClient = useQueryClient()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [dark, setDark] = useTheme()
  const { data: sim } = useSimulationStatus()

  useEffect(() => connectLive(queryClient), [queryClient])

  const nav = sim?.enabled ? [...NAV, { to: '/simulation', label: 'Simulation lab', icon: FlaskConical }] : NAV

  const sidebar = (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
      {nav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end ?? item.to === '/tasks'}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
            )
          }
        >
          <item.icon className="size-4" aria-hidden />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )

  const brand = (
    <div className="flex items-center gap-2 px-5">
      <span className="flex size-7 items-center justify-center rounded-lg bg-blue-600 text-white">
        <Workflow className="size-4" aria-hidden />
      </span>
      <span className="text-sm font-semibold tracking-tight">TaskFlow</span>
    </div>
  )

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-60 shrink-0 flex-col gap-6 border-r border-slate-200 bg-white py-5 lg:flex dark:border-slate-800 dark:bg-slate-900">
        {brand}
        {sidebar}
        <div className="mt-auto flex items-center justify-between px-5">
          <LiveIndicator />
          <button type="button" onClick={() => setDark(!dark)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-900/90">
        <button type="button" onClick={() => setMobileOpen((o) => !o)} className="rounded-md p-1.5" aria-label="Toggle navigation" aria-expanded={mobileOpen}>
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
        {brand}
        <LiveIndicator />
      </header>
      {mobileOpen && <div className="border-b border-slate-200 bg-white py-3 lg:hidden dark:border-slate-800 dark:bg-slate-900">{sidebar}</div>}

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
