import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Evidentia Interactive Papers",
  description: "Upload research papers and explore them interactively."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-gradient-to-br from-slate-100 via-white to-slate-100 text-slate-900">
        <SiteHeader />
        <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10 sm:px-6">
          {children}
        </main>
        <footer className="border-t border-slate-200 bg-white/80 py-8 text-sm text-slate-500">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p>&copy; {new Date().getFullYear()} Evidentia Labs.</p>
            <div className="flex gap-4">
              <a href="#" className="hover:text-slate-700">
                Terms
              </a>
              <a href="#" className="hover:text-slate-700">
                Privacy
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
