"use client";

import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { type Session, type SupabaseClient, type User } from "@supabase/supabase-js";

import { AuthModal, type AuthMode } from "@/components/auth-modal";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

interface EmailAuthResult {
  requiresEmailConfirmation?: boolean;
}

interface AuthModalContextValue {
  open: (mode?: AuthMode) => void;
  close: () => void;
  setMode: (mode: AuthMode) => void;
  isOpen: boolean;
  mode: AuthMode;
  user: User | null;
  session: Session | null;
  isAuthReady: boolean;
  signOut: () => Promise<void>;
}

const AuthModalContext = createContext<AuthModalContextValue | null>(null);

interface AuthModalProviderProps {
  children: ReactNode;
}

export function AuthModalProvider({ children }: AuthModalProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>("login");
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const supabase = useMemo<SupabaseClient | null>(() => getSupabaseBrowserClient(), []);

  useEffect(() => {
    if (!supabase) {
      setIsAuthReady(true);
      return;
    }

    let isMounted = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) {
          return;
        }
        if (error) {
          console.error("Failed to fetch Supabase session", error);
        }
        setSession(data.session ?? null);
        setUser(data.session?.user ?? null);
        setIsAuthReady(true);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }
        console.error("Supabase session request failed", error);
        setIsAuthReady(true);
      });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) {
        return;
      }
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
    });

    return () => {
      isMounted = false;
      authListener?.subscription.unsubscribe();
    };
  }, [supabase]);

  const handleOpen = useCallback((nextMode: AuthMode = "login") => {
    setMode(nextMode);
    setIsOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleModeChange = useCallback((nextMode: AuthMode) => {
    setMode(nextMode);
  }, []);

  const handleEmailAuth = useCallback(
    async ({ mode: authMode, email, password }: { mode: AuthMode; email: string; password: string }): Promise<EmailAuthResult | void> => {
      if (!supabase) {
        throw new Error("Authentication is not available right now.");
      }

      if (authMode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          throw error;
        }
        return;
      }

      const redirectTo = typeof window !== "undefined" ? `${window.location.origin}` : undefined;
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectTo
        }
      });

      if (error) {
        throw error;
      }

      if (!data.session) {
        return { requiresEmailConfirmation: true };
      }
    },
    [supabase]
  );

  const handleGoogleAuth = useCallback(
    async (_mode: AuthMode) => {
      if (!supabase) {
        throw new Error("Authentication is not available right now.");
      }

      const redirectTo = typeof window !== "undefined" ? `${window.location.origin}` : undefined;
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo
        }
      });

      if (error) {
        throw error;
      }

      if (data?.url && typeof window !== "undefined") {
        window.location.href = data.url;
      }
    },
    [supabase]
  );

  const handleSignOut = useCallback(async () => {
    if (!supabase) {
      return;
    }

    const { error } = await supabase.auth.signOut();
    if (error) {
      throw error;
    }
  }, [supabase]);

  const contextValue = useMemo(
    () => ({
      open: handleOpen,
      close: handleClose,
      setMode: handleModeChange,
      isOpen,
      mode,
      user,
      session,
      isAuthReady,
      signOut: handleSignOut
    }),
    [handleClose, handleModeChange, handleOpen, handleSignOut, isAuthReady, isOpen, mode, session, user]
  );

  return (
    <AuthModalContext.Provider value={contextValue}>
      {children}
      <AuthModal
        open={isOpen}
        mode={mode}
        onModeChange={handleModeChange}
        onClose={handleClose}
        onEmailAuth={handleEmailAuth}
        onGoogleAuth={handleGoogleAuth}
      />
    </AuthModalContext.Provider>
  );
}

export function useAuthModal() {
  const context = useContext(AuthModalContext);
  if (!context) {
    throw new Error("useAuthModal must be used within an AuthModalProvider");
  }
  return context;
}
