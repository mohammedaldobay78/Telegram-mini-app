"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/providers";
import { haptic } from "@/lib/telegram";

const LINKS = [
  { href: "/", label: "Tap", icon: "◉" },
  { href: "/store", label: "Store", icon: "▣" },
  { href: "/tasks", label: "Tasks", icon: "✓" },
  { href: "/friends", label: "Friends", icon: "◎" },
  { href: "/wallet", label: "Wallet", icon: "◇" },
];

export function BottomNav() {
  const pathname = usePathname();
  const { session } = useAuth();
  if (!session) return null;
  const links = session.user.isAdmin ? [...LINKS, { href: "/admin", label: "Admin", icon: "⚙" }] : LINKS;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-bg/95 backdrop-blur">
      <div
        className="mx-auto flex max-w-md items-stretch justify-between px-2"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 8px)" }}
      >
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => haptic("select")}
              className={`flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-2 text-[10px] font-semibold ${
                active ? "text-button" : "text-hint"
              }`}
            >
              <span className="text-lg leading-none">{link.icon}</span>
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
