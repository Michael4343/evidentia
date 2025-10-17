import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

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
        {children}
      </body>
    </html>
  );
}
