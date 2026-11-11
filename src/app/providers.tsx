"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthResponse, StateResponse, UserPublic } from "@/lib/types";
import { api, errorMessage } from "@/lib/client-api";
import { initTelegram, rawInitData } from "@/lib/telegram";
import { Button, Card, ErrorNote, Spinner } from "@/components/ui";

interface Session {
  user: UserPublic;
  isNewUser: boolean;
  referralApplied: boolean;
}

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
  error: null,
  retry: () => undefined,
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function useAppState() {
  const { session } = useAuth();
  return useQuery<StateResponse>({
    queryKey: ["state"],
    queryFn: () => api<StateResponse>("/api/state"),
    enabled: Boolean(session),
    refetchInterval: 30_000,
    staleTime: 5_000,
  });
}

export function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries();
}

function AuthProvider({ client, children }: { client: QueryClient; children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    initTelegram();
    if (started.current && attempt === 0) return;
    started.current = true;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const raw = rawInitData();
    if (!raw) {
      setError("Open this Mini App from the Telegram bot. The browser preview has no Telegram session.");
      setLoading(false);
      return;
    }

    api<AuthResponse>("/api/auth/telegram", { method: "POST" })
      .then((response) => {
        if (cancelled) return;
        setSession({
          user: response.user,
          isNewUser: response.isNewUser,
          referralApplied: response.referralApplied,
        });
        client.setQueryData(["state"], response.state);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, client]);

  const value = useMemo(
    () => ({ session, loading, error, retry: () => setAttempt((value) => value + 1) }),
    [session, loading, error],
  );

  return (
    <AuthContext.Provider value={value}>
      {loading ? (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-hint">
          <Spinner className="h-7 w-7 text-button" />
          <span className="text-sm">Connecting to Telegram…</span>
        </div>
      ) : error ? (
        <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
          <Card>
            <h1 className="text-lg font-bold">Earn Money</h1>
            <p className="mt-2 text-sm text-hint">{error}</p>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Reload
              </Button>
            </div>
          </Card>
          <ErrorNote>Identity is validated server-side with Telegram initData.</ErrorNote>
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <AuthProvider client={client}>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
