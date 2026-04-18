import type { Metadata } from "next";
import "./globals.css";
import { LegacyHeader } from "@/components/LegacyHeader";

export const metadata: Metadata = {
  title: "Product Pipeline",
  description: "Дашборд управления продуктовым пайплайном",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className="dark">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased" style={{ background: "var(--bg-0)", color: "var(--text-1)" }}>
        <LegacyHeader />
        <main>{children}</main>
      </body>
    </html>
  );
}
