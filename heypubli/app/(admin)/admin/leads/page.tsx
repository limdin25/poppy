import { AdminLeads } from "@/features/admin-leads";
import { getSignupLeads } from "@/lib/data/signup-leads";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const leads = await getSignupLeads();
  return <AdminLeads leads={leads} />;
}
