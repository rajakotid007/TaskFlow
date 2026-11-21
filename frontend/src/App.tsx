import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useRealtime } from './api/realtime';
import { DashboardPage } from './pages/DashboardPage';
import { TasksPage } from './pages/TasksPage';
import { CreateTaskPage } from './pages/CreateTaskPage';
import { TaskDetailPage } from './pages/TaskDetailPage';
import { ContributorsPage } from './pages/ContributorsPage';
import { RoutingPage } from './pages/RoutingPage';
import { HistoryPage } from './pages/HistoryPage';

export function App() {
  const connection = useRealtime();
  return (
    <Routes>
      <Route element={<Layout connection={connection} />}>
        <Route index element={<DashboardPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="tasks/new" element={<CreateTaskPage />} />
        <Route path="tasks/:id" element={<TaskDetailPage />} />
        <Route path="contributors" element={<ContributorsPage />} />
        <Route path="routing" element={<RoutingPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="*" element={<p className="text-slate-600">Page not found.</p>} />
      </Route>
    </Routes>
  );
}
