import { createBrowserRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from './components/layout/AppLayout'
import { ToastProvider } from './components/ui/Toast'
import { ApiError } from './api/client'
import { DashboardPage } from './pages/DashboardPage'
import { TasksPage } from './pages/TasksPage'
import { NewTaskPage } from './pages/NewTaskPage'
import { TaskDetailPage } from './pages/TaskDetailPage'
import { ContributorsPage } from './pages/ContributorsPage'
import { RoutingPage } from './pages/RoutingPage'
import { ActivityPage } from './pages/ActivityPage'
import { SimulationPage } from './pages/SimulationPage'
import { EmptyState } from './components/ui/primitives'

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2_000,
        // Retry transient failures, not 4xx answers.
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
        refetchOnWindowFocus: true,
      },
    },
  })
}

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/tasks', element: <TasksPage /> },
      { path: '/tasks/new', element: <NewTaskPage /> },
      { path: '/tasks/:id', element: <TaskDetailPage /> },
      { path: '/contributors', element: <ContributorsPage /> },
      { path: '/routing', element: <RoutingPage /> },
      { path: '/activity', element: <ActivityPage /> },
      { path: '/simulation', element: <SimulationPage /> },
      { path: '*', element: <EmptyState title="Page not found" /> },
    ],
  },
])

const queryClient = createQueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  )
}
