import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Family Plan Manager" };
export const viewport: Viewport = { themeColor: "#f5f6f8" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
