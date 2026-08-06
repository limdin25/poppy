import { SidebarNav, MobileNav } from "@/features/sidebar-nav";
import { getUnreadNotificationCount } from "@/lib/data/notifications";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const notificationCount = await getUnreadNotificationCount();

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <MobileNav variant="admin" notificationCount={notificationCount} />
      <aside className="hidden sticky top-0 h-screen border-r border-border bg-background lg:flex">
        <SidebarNav variant="admin" notificationCount={notificationCount} />
      </aside>
      <main className="flex-1 min-h-screen overflow-auto">{children}</main>
    </div>
  );
}
