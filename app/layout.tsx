import type { Metadata } from "next";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/ui/ServiceWorkerRegistration";
import { PushPermissionPrompt } from "@/components/ui/PushPermissionPrompt";

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
    <html lang="en" className="dark">
      <body className="antialiased">
        {children}
        <ServiceWorkerRegistration />
        <PushPermissionPrompt />
      </body>
    </html>
  );
}
