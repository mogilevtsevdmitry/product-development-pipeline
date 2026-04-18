"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function LegacyHeader() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <header className="border-b sticky top-0 z-50" style={{
      borderColor: "var(--border-1)",
      background: "rgba(10,10,15,.85)",
      backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
    }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold" style={{
            background: "var(--accent-lime)", color: "var(--accent-lime-fg)",
          }}>PP</div>
          <span className="font-semibold text-lg">Product Pipeline</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm" style={{ color: "var(--text-3)" }}>
          <Link href="/" style={{ color: "var(--text-2)" }} className="hover:!text-white transition-colors">Проекты</Link>
          <Link href="/agents" style={{ color: "var(--text-2)" }} className="hover:!text-white transition-colors">Агенты</Link>
        </nav>
      </div>
    </header>
  );
}
