import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HeyPubli | For Brands",
  description:
    "Reach authentic micro-influencers in Brazil. Automatic publishing, performance-based commission.",
};

export default function ForBrandsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
