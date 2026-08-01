import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "**.cdninstagram.com",
      },
      {
        protocol: "https",
        hostname: "lmzttpfckdknrmeaecce.supabase.co",
      },
      {
        protocol: "https",
        hostname: "www.scanplates.com",
      },
    ],
  },
  async redirects() {
    // Old Brazilian-era URLs still circulate in emails, DMs and printed material.
    // Send them permanently to the English routes so nothing 404s.
    return [
      { source: "/cadastro", destination: "/signup", permanent: true },
      { source: "/para-marcas", destination: "/for-brands", permanent: true },
      { source: "/bem-vindo", destination: "/welcome", permanent: true },
      { source: "/suspenso", destination: "/suspended", permanent: true },
      { source: "/termos", destination: "/terms", permanent: true },
      // /admin/campanha was linked from the "Add to campaign" admin notification
      // emails; already-delivered emails must keep working.
      { source: "/admin/campanha", destination: "/admin/campaign", permanent: true },
    ];
  },
};

export default nextConfig;
