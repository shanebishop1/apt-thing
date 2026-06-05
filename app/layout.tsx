import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Apt Thing",
  description: "Private AI apartment search dashboard for a 5BR roommate group",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
