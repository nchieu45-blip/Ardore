import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Enable each cut when both encodings ship in public/media/hero.
const heroVariants = ["mobile", "desktop"].filter(variant =>
  ["webm", "mp4"].every(ext => existsSync(join(process.cwd(), "public/media/hero", `${variant}.${ext}`)))
);

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_HERO_VARIANTS: heroVariants.join(",") },
  // Shared hosting exposes more CPUs than its process limit can support.
  experimental: { cpus: 2 },
  allowedDevOrigins: ['127.0.0.1'],
  async headers() {
    return [{
      source: '/:path*',
      has: [{ type: 'host', value: '(?:www\\.)?ardore-health\\.com' }],
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=86400' }],
    }]
  },
  images: {
    qualities: [55, 75],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'yboeyxqeileicecqpwke.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;
