"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { INSTAGRAM_ENABLED } from "@/lib/flags";
import {
  Home,
  BookOpen,
  Calendar,
  BarChart3,
  Bell,
  DollarSign,
  Megaphone,
  Settings,
  Users,
  UserPlus,
  Shield,
  Clock,
  MessageSquare,
  Tag,
  ShoppingCart,
  Wallet,
  Sparkles,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  X,
} from "lucide-react";

// Metrics is Instagram-only data, hidden while Instagram is off (lib/flags.ts).
// Keep this list in step with influencerMain in SidebarNav.tsx: a creator on a
// phone gets this one, and a route that exists in only one of the two is a
// route half the users cannot find.
const influencerItems = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "Setup", href: "/onboarding", icon: BookOpen },
  ...(INSTAGRAM_ENABLED ? [{ label: "Metrics", href: "/metrics", icon: BarChart3 }] : []),
  { label: "Calendar", href: "/calendar", icon: Calendar },
  { label: "Sales", href: "/sales", icon: DollarSign },
  { label: "Settings", href: "/settings", icon: Settings },
];

const adminItems = [
  { label: "Overview", href: "/admin", icon: LayoutDashboard },
  { label: "Notifications", href: "/admin/notifications", icon: Bell },
  { label: "Campaign", href: "/admin/campaign", icon: Megaphone },
  { label: "Signups", href: "/admin/leads", icon: UserPlus },
  { label: "Influencers", href: "/admin/influencers", icon: Users },
  { label: "Scheduler", href: "/admin/scheduler", icon: Clock },
  { label: "Messages", href: "/admin/messages", icon: MessageSquare },
  { label: "Brands", href: "/admin/brands", icon: Tag },
  { label: "Hotmart", href: "/admin/hotmart", icon: ShoppingCart },
  { label: "Payments", href: "/admin/payments", icon: Wallet },
  { label: "Prompts", href: "/admin/prompts", icon: Sparkles },
  { label: "Tutorials", href: "/admin/tutorials", icon: GraduationCap },
  { label: "Settings", href: "/admin/settings", icon: Settings },
];

const NOTIFICATIONS_HREF = "/admin/notifications";

/** The way back to /admin for an admin who is looking at their own creator view. */
const ADMIN_SWITCH = { label: "Admin", href: "/admin", icon: Shield };

interface MobileNavProps {
  variant: "influencer" | "admin";
  notificationCount?: number;
  /** Adds the Admin switch to the creator menu. Ignored on the admin menu. */
  isAdmin?: boolean;
}

export function MobileNav({
  variant,
  notificationCount = 0,
  isAdmin = false,
}: MobileNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items =
    variant === "admin"
      ? adminItems
      : isAdmin
        ? [...influencerItems, ADMIN_SWITCH]
        : influencerItems;

  return (
    <>
      <header className="flex items-center justify-between border-b border-border bg-background px-4 py-3 lg:hidden">
        <Link href={variant === "admin" ? "/admin" : "/dashboard"}>
          <span
            className="text-lg font-bold"
            style={{
              background: "linear-gradient(135deg, #F56040, #E1306C, #C13584)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            HeyPubli
          </span>
        </Link>
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg p-2 text-foreground-secondary hover:bg-background-secondary hover:text-foreground"
        >
          <Menu size={22} />
        </button>
      </header>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            onClick={() => setOpen(false)}
          />
          <nav className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-background shadow-xl lg:hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <Link
                href={variant === "admin" ? "/admin" : "/dashboard"}
                onClick={() => setOpen(false)}
              >
                <span
                  className="text-xl font-bold"
                  style={{
                    background: "linear-gradient(135deg, #F56040, #E1306C, #C13584)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  HeyPubli
                </span>
              </Link>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-foreground-secondary hover:bg-background-secondary hover:text-foreground"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-4 py-4">
              {items.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-all duration-150 active:scale-[0.97] ${
                      isActive
                        ? "bg-accent/10 text-accent"
                        : "text-foreground-secondary hover:bg-background-secondary hover:text-foreground active:bg-background-secondary"
                    }`}
                  >
                    <Icon size={18} />
                    <span className="flex flex-1 items-center justify-between">
                      {item.label}
                      {item.href === NOTIFICATIONS_HREF && notificationCount > 0 && (
                        <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                          {notificationCount}
                        </span>
                      )}
                    </span>
                  </Link>
                );
              })}
            </div>

            <div className="border-t border-border px-4 py-4">
              <form action="/api/auth/signout" method="POST">
                <button
                  type="submit"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground-secondary transition-all duration-150 active:scale-[0.97] hover:bg-red-50 hover:text-error"
                >
                  <LogOut size={18} />
                  Sign out
                </button>
              </form>
            </div>
          </nav>
        </>
      )}
    </>
  );
}
