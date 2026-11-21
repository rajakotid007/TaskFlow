import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

type ToastKind = 'success' | 'error' | 'info'
interface Toast {
  id: number
  kind: ToastKind
  title: string
  message?: string
}

const ToastContext = createContext<(t: Omit<Toast, 'id'>) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])
  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = nextId++
      setToasts((ts) => [...ts.slice(-3), { ...t, id }])
      setTimeout(() => dismiss(id), t.kind === 'error' ? 8000 : 4500)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => {
          const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? AlertTriangle : Info
          return (
            <div
              key={t.id}
              role={t.kind === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex gap-3 rounded-lg border border-slate-200 bg-white p-3.5 shadow-lg dark:border-slate-700 dark:bg-slate-900"
            >
              <Icon
                className={clsx('mt-0.5 size-4 shrink-0', {
                  'text-emerald-600': t.kind === 'success',
                  'text-red-600': t.kind === 'error',
                  'text-blue-600': t.kind === 'info',
                })}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t.title}</p>
                {t.message && <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{t.message}</p>}
              </div>
              <button type="button" onClick={() => dismiss(t.id)} className="self-start rounded p-0.5 text-slate-400 hover:text-slate-600" aria-label="Dismiss notification">
                <X className="size-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
