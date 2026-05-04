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
        {/* Animated wavy-grid background — fixed under everything */}
        <svg
          aria-hidden="true"
          width="0"
          height="0"
          style={{ position: 'absolute', width: 0, height: 0 }}
        >
          <defs>
            <filter id="wavyGrid" x="-5%" y="-5%" width="110%" height="110%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.012 0.018"
                numOctaves="2"
                seed="3"
                result="noise"
              />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="12" />
            </filter>
          </defs>
        </svg>
        <div className="wavy-grid-bg" aria-hidden="true" />
        {children}
        <ServiceWorkerRegistration />
        <PushPermissionPrompt />
      </body>
    </html>
  );
}
