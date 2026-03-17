import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nilli Studio",
  description: "Production management for Nilli Studio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
