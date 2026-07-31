import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardCalendar } from "@/features/dashboard-calendar";
import { getPostsByProfile } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function CalendarioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const posts = await getPostsByProfile(user.id);

  return <DashboardCalendar posts={posts} />;
}
