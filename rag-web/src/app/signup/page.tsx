"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useAuth } from "@/context/AuthContext";
import { httpErrorDetail } from "@/lib/apiError";
import "../styles/auth.scss";

const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;

export default function SignupPage() {
  const router = useRouter();
  const { signup } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;

    const user = username.trim();
    if (user.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }
    if (user.length > 50) {
      setError("Username must not exceed 50 characters.");
      return;
    }
    if (!USERNAME_RE.test(user)) {
      setError("Username may only contain letters, numbers, hyphens, and underscores.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password.length > 100) {
      setError("Password must not exceed 100 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await signup(user, password);
      router.push("/login");
    } catch (err) {
      setError(httpErrorDetail(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-icon">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="brand-name">RAGStudio</span>
        </div>

        <h1 className="auth-title">Create account</h1>
        <p className="auth-subtitle">Get started with your document workspace</p>

        <form onSubmit={onSubmit}>
          <div className="form-field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              name="username"
              required
              minLength={3}
              maxLength={50}
              autoComplete="username"
              disabled={busy}
              placeholder="Letters, numbers, _ or - (3–50 chars)"
            />
          </div>

          <div className="form-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              name="password"
              required
              minLength={6}
              autoComplete="new-password"
              disabled={busy}
              placeholder="Choose a password (min 6 chars)"
            />
          </div>

          <div className="form-field">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              name="confirmPassword"
              required
              autoComplete="new-password"
              disabled={busy}
              placeholder="Re-enter your password"
            />
          </div>

          {error && (
            <div className="error-banner" aria-live="assertive">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn-submit"
            disabled={busy || !username || !password || !confirmPassword}
          >
            {busy ? "Creating account…" : "Create Account"}
          </button>
        </form>

        <div className="auth-footer">
          Already have an account?{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => router.push("/login")}
          >
            Sign in
          </button>
        </div>
      </div>
    </div>
  );
}
