import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Route } from "./+types/root";
import {
  getCurrentUser,
  signIn as puterSignIn,
  signOut as puterSignOut,
  synchronizePuterAuthTokenFromStorage,
} from "../lib/puter.action";
import {
  subscribeToPuterAccountMutations,
  withPuterAccountIntentLock,
} from "../lib/puter.account";
import { clearFloorPlanUploadSessionsForOwner } from "../lib/upload";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

const DEFAULT_AUTH_STATE: AuthState = {
  isAuthReady: false,
  isAuthTransitioning: false,
  isSignedIn: false,
  userName: null,
  userId: null,
};

export default function App() {
  const [authState, setAuthState] = useState<AuthState>(DEFAULT_AUTH_STATE);
  const authStateRef = useRef<AuthState>(DEFAULT_AUTH_STATE);
  const authOperationRef = useRef(0);
  const authMutationInFlightRef = useRef(false);
  const externalPreviousUserIdRef = useRef<string | null>(null);
  const externalAuthSyncRef = useRef(Promise.resolve());

  const commitAuthState = useCallback((nextState: AuthState) => {
    authStateRef.current = nextState;
    setAuthState(nextState);
  }, []);

  const resolveAuth = useCallback(async (
    operationId: number,
    isAuthTransitioning = false,
  ) => {
    if (operationId !== authOperationRef.current) {
      return authStateRef.current.isSignedIn;
    }

    try {
      const user = await getCurrentUser();

      if (operationId !== authOperationRef.current) {
        return authStateRef.current.isSignedIn;
      }

      if (!user) {
        commitAuthState({
          ...DEFAULT_AUTH_STATE,
          isAuthReady: true,
          isAuthTransitioning,
        });
        return false;
      }

      commitAuthState({
        isAuthReady: true,
        isAuthTransitioning,
        isSignedIn: !!user,
        userName: user?.username || null,
        userId: user?.uuid || null,
      });
      return !!user;
    } catch (error) {
      console.error("Error refreshing auth state:", error);

      if (operationId === authOperationRef.current) {
        commitAuthState({
          ...DEFAULT_AUTH_STATE,
          isAuthReady: true,
          isAuthTransitioning,
        });
      }

      return false;
    }
  }, [commitAuthState]);

  const refreshAuth = useCallback(() => {
    if (authMutationInFlightRef.current) {
      return Promise.resolve(authStateRef.current.isSignedIn);
    }

    const operationId = ++authOperationRef.current;
    return resolveAuth(operationId);
  }, [resolveAuth]);

  const getAuthSnapshot = useCallback(() => authStateRef.current, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(
    () =>
      subscribeToPuterAccountMutations(() => {
        authOperationRef.current += 1;
        if (authStateRef.current.userId) {
          externalPreviousUserIdRef.current = authStateRef.current.userId;
        }
        commitAuthState({
          ...DEFAULT_AUTH_STATE,
          isAuthReady: true,
          isAuthTransitioning: true,
        });

        externalAuthSyncRef.current = externalAuthSyncRef.current
          .catch(() => undefined)
          .then(async () => {
            const operationId = ++authOperationRef.current;
            try {
              await withPuterAccountIntentLock(() =>
                {
                  synchronizePuterAuthTokenFromStorage();
                  return resolveAuth(operationId, true);
                },
              );

              const nextUserId = authStateRef.current.userId;
              const previousUserId = externalPreviousUserIdRef.current;
              if (previousUserId && previousUserId !== nextUserId) {
                clearFloorPlanUploadSessionsForOwner(previousUserId);
              }
              externalPreviousUserIdRef.current = nextUserId;

              if (operationId === authOperationRef.current) {
                commitAuthState({
                  ...authStateRef.current,
                  isAuthTransitioning: false,
                });
              }
            } catch (error) {
              console.error("Error synchronizing Puter account state:", error);
              if (operationId === authOperationRef.current) {
                commitAuthState({
                  ...DEFAULT_AUTH_STATE,
                  isAuthReady: true,
                });
              }
            }
          });
      }),
    [commitAuthState, resolveAuth],
  );

  const signIn = useCallback(async () => {
    if (authMutationInFlightRef.current) return false;

    authMutationInFlightRef.current = true;
    const operationId = ++authOperationRef.current;
    commitAuthState({
      ...authStateRef.current,
      isAuthTransitioning: true,
    });

    try {
      await puterSignIn();
      return await resolveAuth(operationId, true);
    } catch (error) {
      await resolveAuth(operationId, true);
      throw error;
    } finally {
      authMutationInFlightRef.current = false;
      if (operationId === authOperationRef.current) {
        commitAuthState({
          ...authStateRef.current,
          isAuthTransitioning: false,
        });
      }
    }
  }, [commitAuthState, resolveAuth]);

  const signOut = useCallback(async () => {
    if (authMutationInFlightRef.current) return false;

    authMutationInFlightRef.current = true;
    const operationId = ++authOperationRef.current;
    const previousUserId = authStateRef.current.userId;

    commitAuthState({
      ...DEFAULT_AUTH_STATE,
      isAuthReady: true,
      isAuthTransitioning: true,
    });

    try {
      await puterSignOut();
      const isSignedIn = await resolveAuth(operationId, true);

      if (!isSignedIn && previousUserId) {
        clearFloorPlanUploadSessionsForOwner(previousUserId);
      }

      return isSignedIn;
    } catch (error) {
      await resolveAuth(operationId, true);
      throw error;
    } finally {
      authMutationInFlightRef.current = false;
      if (operationId === authOperationRef.current) {
        commitAuthState({
          ...authStateRef.current,
          isAuthTransitioning: false,
        });
      }
    }
  }, [commitAuthState, resolveAuth]);

  return (<div className="min-h-screen bg-background text-foreground relative z-10">
    <Outlet 
    context={{...authState, refreshAuth, getAuthSnapshot, signIn, signOut}}
    />
  </div>
   );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
