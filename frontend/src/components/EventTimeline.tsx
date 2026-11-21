import { Link } from 'react-router'
import clsx from 'clsx'
import { ArrowRight } from 'lucide-react'
import { Badge, DOT, EmptyState } from './ui/primitives'
import type { TaskEvent } from '../api/types'
import { ACTOR_LABEL, EVENT_LABEL, EVENT_TONE, humanize } from '../lib/status'
import { formatDateTime, formatRelative } from '../lib/format'

export function EventTimeline({ events, showTask = false, dense = false }: { events: TaskEvent[]; showTask?: boolean; dense?: boolean }) {
  if (events.length === 0) return <EmptyState title="No activity yet" />
  return (
    <ol className="relative">
      {events.map((e, i) => {
        const tone = EVENT_TONE[e.event_type] ?? 'gray'
        const stateChanged = e.previous_state && e.new_state && e.previous_state !== e.new_state
        return (
          <li key={e.id} className={clsx('relative flex gap-3', dense ? 'pb-3' : 'pb-5')} data-testid="timeline-event" data-event-type={e.event_type}>
            {i < events.length - 1 && <span className="absolute top-4 left-[5px] h-full w-px bg-slate-200 dark:bg-slate-800" aria-hidden />}
            <span className={clsx('relative mt-1.5 size-[11px] shrink-0 rounded-full ring-4 ring-white dark:ring-slate-900', DOT[tone])} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge tone={tone}>{EVENT_LABEL[e.event_type] ?? humanize(e.event_type)}</Badge>
                <span className="text-xs text-slate-500">{ACTOR_LABEL[e.actor_type]}</span>
                {showTask && (
                  <Link to={`/tasks/${e.task.id}`} className="truncate text-xs font-medium text-blue-700 hover:underline dark:text-blue-400">
                    #{e.task.id} {e.task.title}
                  </Link>
                )}
                <time dateTime={e.created_at} title={formatDateTime(e.created_at)} className="ml-auto text-xs text-slate-400 tabular-nums">
                  {dense ? formatRelative(e.created_at) : formatDateTime(e.created_at)}
                </time>
              </div>
              <p className={clsx('mt-1 text-slate-700 dark:text-slate-300', dense ? 'text-xs' : 'text-sm')}>{e.message}</p>
              {stateChanged && !dense && (
                <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                  {humanize(e.previous_state)} <ArrowRight className="size-3" aria-label="to" /> {humanize(e.new_state)}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
