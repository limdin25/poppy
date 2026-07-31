import { AdminPayouts } from "@/features/admin-payouts";
import { getPendingPayoutRequests, getAllPayouts } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function PagamentosPage() {
  const [pending, all] = await Promise.all([getPendingPayoutRequests(), getAllPayouts()]);
  const history = all.filter((p) => p.status !== "requested");

  return <AdminPayouts pending={pending} history={history} />;
}
