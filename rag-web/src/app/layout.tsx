import type { Metadata } from "next";

import { AuthProvider } from "@/context/AuthContext";
import "./globals.scss";

export const metadata: Metadata = {
  title: "RAGStudio — Intelligent Document Q&A",
  description: "Upload a PDF and ask questions about it.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
