import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MotionClone Studio — Meta SAM 3.1 + Muse Spark 1.3 Physics UI Compiler",
  description:
    "Reverse-engineer any UI screen recording into exact spring-physics React, SwiftUI, and CSS code using Meta SAM 3.1 video concept tracking and Muse Spark 1.3.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#050811] text-slate-100 antialiased selection:bg-cyan-500/30 selection:text-cyan-200">
        {children}
      </body>
    </html>
  );
}
