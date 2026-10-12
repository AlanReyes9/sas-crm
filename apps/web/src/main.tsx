import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./lib/auth";
import { realtimeEnabled } from "./lib/socket";
import { App } from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: realtimeEnabled ? 10_000 : 3_000,
      retry: 1,
      refetchOnWindowFocus: !realtimeEnabled,
      // Sin Socket.IO, las vistas se actualizan solas cada 5 s mientras la pestaña está visible.
      refetchInterval: realtimeEnabled ? false : 5_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
