import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { Layout } from './components/Layout';
import { LogsPage } from './pages/LogsPage';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { RegisterPage } from './pages/RegisterPage';
import { RequestInspectorPage } from './pages/RequestInspectorPage';
import { TunnelDetailsPage } from './pages/TunnelDetailsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 60s polling fallback — primary live updates come from the /api/ws/dashboard push channel
      // (useDashboardWS, wired in Layout). Kept non-zero so the UI self-heals if the WS drops.
      refetchInterval: 60_000,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/" element={<OverviewPage />} />
                <Route path="/tunnels/:id" element={<TunnelDetailsPage />} />
                <Route path="/logs" element={<LogsPage />} />
                <Route path="/logs/:id" element={<RequestInspectorPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
