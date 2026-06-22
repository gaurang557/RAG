"use client";

import { AuthGuard } from "@/components/AuthGuard";
import { HomeWorkspace } from "@/components/HomeWorkspace";

export default function HomePage() {
  return (
    <AuthGuard>
      <HomeWorkspace />
    </AuthGuard>
  );
}
