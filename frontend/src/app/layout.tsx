import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harbor - Tauri + Next.js",
  description: "A Tauri v2 app with Next.js App Router",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
