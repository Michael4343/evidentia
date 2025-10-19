import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import "./globals.css";
import { AuthModalProvider } from "@/components/auth-modal-provider";
import { PostHogProvider } from "@/lib/posthog-provider";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Evidentia Interactive Papers",
  description: "Upload research papers and explore them interactively."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-gradient-to-br from-slate-100 via-white to-slate-100 text-slate-900">
        <PostHogProvider>
          <AuthModalProvider>{children}</AuthModalProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
