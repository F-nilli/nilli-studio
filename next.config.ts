import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return ['/portal-admin/:path*', '/api/portal/:path*'].map(source => ({source, headers: [
      {key: 'Cache-Control', value: 'no-cache, no-store, max-age=0'},
      {key: 'Referrer-Policy', value: 'no-referrer'},
      {key: 'Pragma', value: 'no-cache'},
    ]}));
  },
};

export default nextConfig;
