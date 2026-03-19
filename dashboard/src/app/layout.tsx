import type { Metadata } from "next";
import "./globals.css";

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
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-gray-950 text-white antialiased">
        <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
            <a href="/" className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-sm font-bold">
                PP
              </div>
              <span className="font-semibold text-lg">Product Pipeline</span>
            </a>
            <nav className="flex items-center gap-4 text-sm text-gray-400">
              <a href="/" className="hover:text-white transition-colors">
                Проекты
              </a>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
