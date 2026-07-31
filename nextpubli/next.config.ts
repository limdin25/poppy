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
};

export default nextConfig;
