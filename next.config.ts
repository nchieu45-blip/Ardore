import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
