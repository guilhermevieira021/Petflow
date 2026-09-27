import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { ToastProvider } from '@/components/ui/Toast';
import { SessionProvider } from '@/features/auth/session';
import { ThemeProvider } from '@/features/theme/ThemeProvider';
import { ApiError } from '@/lib/api';
import { router } from '@/router';
import '@/styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 401/403 sao respostas definitivas: repetir so gasta banda e atrasa a
      // tela de login.
      retry: (failureCount, error) =>
        error instanceof ApiError && (error.isUnauthenticated || error.isForbidden)
          ? false
          : failureCount < 2,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('Elemento #root não encontrado no documento.');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SessionProvider>
          <ThemeProvider>
            <RouterProvider router={router} />
          </ThemeProvider>
        </SessionProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
