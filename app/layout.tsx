import type { Metadata, Viewport } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import { SEARCH_CONFIG } from "@/lib/search-config";
import "./globals.css";

const bodyFont = DM_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const headingFont = Manrope({ subsets: ["latin"], variable: "--font-heading", display: "swap" });

export const metadata: Metadata = {
  title: "Apt Thing",
  description: `Private AI apartment search dashboard for a ${SEARCH_CONFIG.minBedrooms}BR roommate group`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${headingFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
