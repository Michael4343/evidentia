"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

export type AuthMode = "login" | "signup";

type EmailAuthResult = {
  requiresEmailConfirmation?: boolean;
};

interface AuthModalProps {
  open: boolean;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onClose: () => void;
  onEmailAuth: (payload: { mode: AuthMode; email: string; password: string }) => Promise<EmailAuthResult | void>;
  onGoogleAuth: (mode: AuthMode) => Promise<void>;
}

interface FieldErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export function AuthModal({
  open,
  mode,
  onModeChange,
  onClose,
  onEmailAuth,
  onGoogleAuth
}: AuthModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean; confirmPassword?: boolean }>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const idPrefix = useMemo(() => Math.random().toString(36).slice(2), []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }

      if (event.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) {
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    const focusTimer = window.setTimeout(() => {
      firstFieldRef.current?.focus();
    }, 0);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(focusTimer);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setTouched({});
    setErrors({});
    setFormError(null);
    setFormNotice(null);
    setIsLoading(false);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setFormError(null);
    setFormNotice(null);
    setTouched((prev) => ({
      ...prev,
      password: false,
      confirmPassword: false
    }));
    if (mode === "login") {
      setConfirmPassword("");
    }
  }, [mode, open]);

  const validate = () => {
    const nextErrors: FieldErrors = {};
    if (!email.trim()) {
      nextErrors.email = "Email is required.";
    } else if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      nextErrors.email = "Please enter a valid email address.";
    }

    if (!password) {
      nextErrors.password = "Password is required.";
    } else if (password.length < 6) {
      nextErrors.password = "Password must be at least 6 characters.";
    }

    if (mode === "signup") {
      if (!confirmPassword) {
        nextErrors.confirmPassword = "Please confirm your password.";
      } else if (confirmPassword !== password) {
        nextErrors.confirmPassword = "Passwords do not match.";
      }
    }

    setErrors(nextErrors);
    return nextErrors;
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    validate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, password, confirmPassword, mode]);

  const isFormValid = useMemo(() => {
    if (Object.keys(errors).length > 0) {
      return false;
    }
    if (!email || !password) {
      return false;
    }
    if (mode === "signup" && (!confirmPassword || confirmPassword !== password)) {
      return false;
    }
    return true;
  }, [confirmPassword, email, errors, mode, password]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched({ email: true, password: true, confirmPassword: mode === "signup" });
    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsLoading(true);
    setFormError(null);
    setFormNotice(null);
    try {
      const result = await onEmailAuth({ mode, email: email.trim(), password });
      if (result?.requiresEmailConfirmation) {
        setFormNotice("Check your email to confirm your account before signing in.");
        return;
      }
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed. Please try again.";
      setFormError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    if (isLoading) {
      return;
    }
    setIsLoading(true);
    setFormError(null);
    setFormNotice(null);
    try {
      await onGoogleAuth(mode);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "We couldn't connect to Google. Please try again.";
      setFormError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const showEmailError = touched.email && errors.email;
  const showPasswordError = touched.password && errors.password;
  const showConfirmError = touched.confirmPassword && errors.confirmPassword;

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-8"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${idPrefix}-auth-title`}
        className="relative w-full max-w-[420px] rounded-xl bg-white p-6 shadow-xl focus:outline-none"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:text-slate-600"
          aria-label="Close authentication modal"
          disabled={isLoading}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="h-5 w-5"
          >
            <path d="M18 6L6 18" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="flex max-h-[calc(100vh-4rem)] flex-col gap-6 overflow-y-auto">
          <div className="space-y-2 text-center">
            <h2 id={`${idPrefix}-auth-title`} className="text-lg font-semibold tracking-[0.2em] text-slate-900">
              EVIDENTIA
            </h2>
            <p className="text-sm text-slate-500">
              Evidentia works best on a computer. Please continue on desktop for the full experience.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {(["login", "signup"] as AuthMode[]).map((tab) => {
              const isActive = tab === mode;
              return (
                <button
                  key={tab}
                  type="button"
                  className={`flex-1 rounded-full border px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900"
                  }`}
                  onClick={() => onModeChange(tab)}
                  disabled={isLoading}
                >
                  {tab === "login" ? "Login" : "Sign up"}
                </button>
              );
            })}
          </div>

          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {formError}
            </div>
          )}

          {formNotice && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {formNotice}
            </div>
          )}

          <div className="space-y-4">
            <button
              type="button"
              onClick={handleGoogleAuth}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isLoading}
            >
              <svg
                className="h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  fill="#4285F4"
                  d="M23.52 12.273c0-.82-.074-1.604-.211-2.352H12v4.452h6.48c-.28 1.5-1.126 2.774-2.4 3.63v3.02h3.88c2.27-2.094 3.56-5.18 3.56-8.75z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.96-1.076 7.947-2.927l-3.88-3.02c-1.077.72-2.452 1.152-4.067 1.152-3.127 0-5.773-2.114-6.717-4.955H1.323v3.11C3.3 21.53 7.32 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.283 14.25c-.24-.72-.377-1.492-.377-2.25s.137-1.53.377-2.25V6.64H1.323A11.96 11.96 0 0 0 0 12c0 1.94.463 3.774 1.323 5.36l3.96-3.11z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.76 0 3.34.605 4.59 1.792l3.44-3.44C17.96 1.115 15.24 0 12 0 7.32 0 3.3 2.47 1.323 6.64l3.96 3.11C6.227 6.864 8.873 4.75 12 4.75z"
                />
              </svg>
              {mode === "login" ? "Continue with Google" : "Sign up with Google"}
            </button>

            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
              <span>OR</span>
              <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="space-y-1 text-left">
                  <span className="text-xs font-medium text-slate-600">Email</span>
                  <input
                    ref={firstFieldRef}
                    type="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                    }}
                    onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
                    className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 transition focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:cursor-not-allowed disabled:opacity-70"
                    placeholder="Enter your email"
                    required
                    disabled={isLoading}
                  />
                </label>
                {showEmailError && <p className="text-xs text-red-600">{showEmailError}</p>}
              </div>

              <div className="space-y-2">
                <label className="space-y-1 text-left">
                  <span className="text-xs font-medium text-slate-600">Password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                    }}
                    onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
                    className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 transition focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:cursor-not-allowed disabled:opacity-70"
                    placeholder={mode === "login" ? "Enter your password" : "Create a password (min. 6 characters)"}
                    required
                    disabled={isLoading}
                  />
                </label>
                {showPasswordError && <p className="text-xs text-red-600">{showPasswordError}</p>}
              </div>

              {mode === "signup" && (
                <div className="space-y-2">
                  <label className="space-y-1 text-left">
                    <span className="text-xs font-medium text-slate-600">Confirm password</span>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => {
                        setConfirmPassword(event.target.value);
                      }}
                      onBlur={() => setTouched((prev) => ({ ...prev, confirmPassword: true }))}
                      className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 transition focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:cursor-not-allowed disabled:opacity-70"
                      placeholder="Confirm your password"
                      required
                      disabled={isLoading}
                    />
                  </label>
                  {showConfirmError && <p className="text-xs text-red-600">{showConfirmError}</p>}
                </div>
              )}

              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-900/60"
                disabled={!isFormValid || isLoading}
              >
                {isLoading && (
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                )}
                {mode === "login" ? "Sign in" : "Create account"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
