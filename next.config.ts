import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Shared hosting exposes more CPUs than its process limit can support.
  experimental: { cpus: 2 },
  allowedDevOrigins: ['127.0.0.1'],
  async redirects() {
    return [{
      source: '/:path*',
      has: [{ type: 'host', value: 'ardore-health.com' }],
      destination: 'https://www.ardore-health.com/:path*',
      permanent: true,
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
