import { AdminBrands } from "@/features/admin-brands";
import { getAllBrands, getBrandAssignmentCount } from "@/lib/data";

export default async function MarcasPage() {
  const brands = await getAllBrands();

  const rows = await Promise.all(
    brands.map(async (brand) => ({
      brand,
      influencerCount: await getBrandAssignmentCount(brand.id),
    })),
  );

  return <AdminBrands brands={rows} />;
}
