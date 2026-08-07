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
  Megaphone,
  Settings,
  Users,
  UserPlus,
  Shield,
  Clapperboard,
  Clock,
  MessageSquare,
  Tag,
  Sparkles,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";

// Metrics is Instagram-only data, hidden while Instagram is off (lib/flags.ts).
// Setup (/onboarding) sits second, right under Home: it is the first thing a
// new creator needs and the thing they come back to when their affiliate link
// changes. It is never hidden by a flag, because the page explains what to do
// while Instagram is off as well as when it is on.
const influencerMain = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "Setup", href: "/onboarding", icon: BookOpen },
  ...(INSTAGRAM_ENABLED ? [{ label: "Metrics", href: "/metrics", icon: BarChart3 }] : []),
  { label: "Calendar", href: "/calendar", icon: Calendar },
];

const influencerBottom = [{ label: "Settings", href: "/settings", icon: Settings }];

const adminMain = [
  { label: "Overview", href: "/admin", icon: LayoutDashboard },
  { label: "Notifications", href: "/admin/notifications", icon: Bell },
  { label: "Campaign", href: "/admin/campaign", icon: Megaphone },
  { label: "Videos", href: "/admin/videos", icon: Clapperboard },
  { label: "Signups", href: "/admin/leads", icon: UserPlus },
  { label: "Influencers", href: "/admin/influencers", icon: Users },
  { label: "Scheduler", href: "/admin/scheduler", icon: Clock },
  { label: "Messages", href: "/admin/messages", icon: MessageSquare },
  { label: "Brands", href: "/admin/brands", icon: Tag },
  { label: "Prompts", href: "/admin/prompts", icon: Sparkles },
  { label: "Tutorials", href: "/admin/tutorials", icon: GraduationCap },
];

const adminBottom = [{ label: "Settings", href: "/admin/settings", icon: Settings }];

const NOTIFICATIONS_HREF = "/admin/notifications";

/** The way back to /admin for an admin who is looking at their own creator view. */
const ADMIN_SWITCH = { label: "Admin", href: "/admin", icon: Shield };

interface SidebarNavProps {
  variant: "influencer" | "admin";
  notificationCount?: number;
  /** Adds the Admin switch to the creator menu. Ignored on the admin menu. */
  isAdmin?: boolean;
}

export function SidebarNav({
  variant,
  notificationCount = 0,
  isAdmin = false,
}: SidebarNavProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const mainItems = variant === "admin" ? adminMain : influencerMain;
  const bottomItems =
    variant === "admin"
      ? adminBottom
      : isAdmin
        ? [ADMIN_SWITCH, ...influencerBottom]
        : influencerBottom;

  return (
    <nav
      className={`flex h-full flex-col overflow-y-auto ${collapsed ? "w-16" : "w-64"} transition-all duration-200`}
    >
      <div className="flex items-center justify-between p-4">
        {!collapsed && (
          <Link href={variant === "admin" ? "/admin" : "/dashboard"} className="px-3">
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
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="rounded-lg p-2 text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground"
          title={collapsed ? "Expand menu" : "Collapse menu"}
        >
          {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-0.5 px-3">
        {mainItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-all duration-150 active:scale-[0.97] ${
                isActive
                  ? "bg-accent/10 text-accent"
                  : "text-foreground-secondary hover:bg-background-secondary hover:text-foreground active:bg-background-secondary"
              } ${collapsed ? "justify-center" : ""}`}
            >
              <span className="relative">
                <Icon size={18} />
                {item.href === NOTIFICATIONS_HREF &&
                  notificationCount > 0 &&
                  collapsed && (
                    <span className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-accent" />
                  )}
              </span>
              {!collapsed && (
                <span className="flex flex-1 items-center justify-between">
                  {item.label}
                  {item.href === NOTIFICATIONS_HREF && notificationCount > 0 && (
                    <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                      {notificationCount}
                    </span>
                  )}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="mt-auto border-t border-border px-3 py-3">
        {bottomItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-all duration-150 active:scale-[0.97] ${
                isActive
                  ? "bg-accent/10 text-accent"
                  : "text-foreground-secondary hover:bg-background-secondary hover:text-foreground active:bg-background-secondary"
              } ${collapsed ? "justify-center" : ""}`}
            >
              <Icon size={18} />
              {!collapsed && item.label}
            </Link>
          );
        })}
        <form action="/api/auth/signout" method="POST">
          <button
            type="submit"
            title={collapsed ? "Sign out" : undefined}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground-secondary transition-all duration-150 active:scale-[0.97] hover:bg-red-50 hover:text-error ${collapsed ? "justify-center" : ""}`}
          >
            <LogOut size={18} />
            {!collapsed && "Sign out"}
          </button>
        </form>
      </div>
    </nav>
  );
}
