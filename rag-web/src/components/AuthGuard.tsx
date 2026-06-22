"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "@/context/AuthContext";

/**
 * Client-side route protection. Ports Angular's `authGuard`: redirects to /login
 * when there is no authenticated session. Waits for the initial credential check
 * (`ready`) to avoid bouncing a valid, still-restoring session.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !isAuthenticated) {
      router.replace("/login");
    }
  }, [ready, isAuthenticated, router]);

  if (!ready || !isAuthenticated) {
    return null;
  }
  return <>{children}</>;
}
