import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import Script from "next/script";
import { themeScript } from "@/lib/theme-script";
import "./globals.css";

const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Folio — net worth tracker",
  description:
    "Track Indian stocks, US stocks, mutual funds and crypto across every broker in one place. Your data stays encrypted in your browser.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full">
        <Script id="theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        {children}
      </body>
    </html>
  );
}
