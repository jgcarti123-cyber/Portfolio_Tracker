import type { Metadata, Viewport } from "next";
import { Archivo, Instrument_Serif, Inter_Tight } from "next/font/google";
import Script from "next/script";
import { themeScript } from "@/lib/theme-script";
import "./globals.css";

/** Text: a neutral grotesque in the spirit of the Helvetica used in classic electronics ads. */
const interTight = Inter_Tight({ variable: "--font-inter-tight", subsets: ["latin"] });
/** Labels and figures: a rational grotesque with a width axis, set extended like engraved panel legends. */
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], axes: ["wdth"] });
/** Display: a high-contrast editorial serif, for the welcome screen's headline. */
const instrument = Instrument_Serif({ variable: "--font-instrument", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "Folio — net worth tracker",
  description:
    "Track Indian stocks, US stocks, mutual funds and crypto across every broker in one place. Your data stays encrypted in your browser.",
  applicationName: "Folio",
  appleWebApp: { capable: true, title: "Folio", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

/** Fill the whole screen on phones (the masthead pads itself below the notch). */
export const viewport: Viewport = {
  themeColor: "#0a0b0d",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${interTight.variable} ${archivo.variable} ${instrument.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full">
        <Script id="theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        {children}
      </body>
    </html>
  );
}
