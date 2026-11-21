import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
