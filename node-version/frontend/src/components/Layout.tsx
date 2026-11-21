import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, ListChecks, PlusCircle, Users, Radio, History, Route } from 'lucide-react';
import type { ConnectionState } from '../api/realtime';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/tasks', label: 'Tasks', icon: ListChecks },
  { to: '/routing', label: 'Routing', icon: Route },
  { to: '/contributors', label: 'Contributors', icon: Users },
  { to: '/history', label: 'Activity', icon: History },
];

export function Layout({ connection }: { connection: ConnectionState }) {
  const live = connection === 'live';
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-white md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-3 px-4 py-4 md:block">
          <div>
            <p className="text-lg font-bold tracking-tight text-slate-900">TaskFlow</p>
            <p className="text-xs text-slate-500">Operations platform</p>
          </div>
          <span
            data-testid="connection-status"
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium md:mt-3 ${live ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}
            title={live ? 'Receiving live updates' : 'Live connection unavailable; refreshing by polling'}
          >
            <Radio className="h-3 w-3" aria-hidden />
            {live ? 'Live' : connection === 'connecting' ? 'Connecting' : 'Polling'}
          </span>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col md:px-3 md:pb-0">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`
              }
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </NavLink>
          ))}
          <NavLink
            to="/tasks/new"
            className="ml-auto flex shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 md:ml-0 md:mt-4"
          >
            <PlusCircle className="h-4 w-4" aria-hidden />
            New task
          </NavLink>
        </nav>
      </aside>
      <main className="flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
