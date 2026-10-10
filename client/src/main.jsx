import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import enGB from 'antd/locale/en_GB';
import dayjs from 'dayjs';
import 'dayjs/locale/en-gb';
import { AuthProvider } from './auth/AuthContext.jsx';
import App from './App.jsx';
import { QuickAddProvider } from './components/masters/QuickAdd.jsx';
import { ThemedConfig, UiThemeProvider } from './theme/ThemeContext.jsx';
import './styles.css';
import './theme/desktop-green.css';

dayjs.locale('en-gb');

const queryClient = new QueryClient({
  // retry once on a network / server hiccup; never on 4xx (no permission, not found, bad input) — it would fail again
  defaultOptions: {
    queries: {
      retry: (count, err) => { const st = err?.response?.status; return count < 1 && !(st >= 400 && st < 500); },
      refetchOnWindowFocus: false, staleTime: 30_000,
    },
  },
});

// The look (colours, density, sidebar) comes from the chosen theme — see theme/themes.js.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <UiThemeProvider>
      <ThemedConfig locale={enGB}>
        <AntApp>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <AuthProvider>
                {/* "+ New …" in master drop-downs anywhere (components/masters) */}
                <QuickAddProvider>
                  <App />
                </QuickAddProvider>
              </AuthProvider>
            </BrowserRouter>
          </QueryClientProvider>
        </AntApp>
      </ThemedConfig>
    </UiThemeProvider>
  </React.StrictMode>,
);
