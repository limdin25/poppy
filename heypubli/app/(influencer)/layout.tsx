import { SidebarNav, MobileNav } from "@/features/sidebar-nav";
import { getCurrentProfile } from "@/lib/data";

export default async function InfluencerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // An admin with a creator account of their own lands here whenever they open the site
  // with a session already running, and the sign-in redirect to /admin only fires on a
  // fresh login. Without a way across they are stuck looking at the creator view.
  const profile = await getCurrentProfile();
  const isAdmin = Boolean(profile?.is_admin);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <MobileNav variant="influencer" isAdmin={isAdmin} />
      <aside className="hidden sticky top-0 h-screen border-r border-border bg-background lg:flex">
        <SidebarNav variant="influencer" isAdmin={isAdmin} />
      </aside>
      <main className="flex-1 min-h-screen overflow-auto">{children}</main>
    </div>
  );
}
