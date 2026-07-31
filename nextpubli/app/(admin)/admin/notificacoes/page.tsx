import { AdminNotifications } from "@/features/admin-notifications";
import { getNotifications } from "@/lib/data/notifications";

export const dynamic = "force-dynamic";

export default async function NotificacoesPage() {
  const notifications = await getNotifications();

  return <AdminNotifications notifications={notifications} />;
}
