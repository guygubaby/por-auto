import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query';
import { router } from './router';
import { desktop, invoke } from './lib/bridge';
import { useUI } from './lib/ui-store';
import { applyTheme } from './hooks/use-theme';
import './styles.css';
async function start() {
  if (desktop) {
    const settings = await invoke<{ theme: unknown }>('ui_settings').catch(
      () => null,
    );
    if (
      settings?.theme === 'light' ||
      settings?.theme === 'dark' ||
      settings?.theme === 'system'
    ) {
      useUI.getState().setTheme(settings.theme);
    }
  }
  applyTheme(useUI.getState().theme);
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}
void start();
