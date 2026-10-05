/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * The dev server is reached through a proxied preview host, not through
   * `localhost`, so Next must be told that requests carrying a foreign Origin
   * (HMR assets, server actions) are legitimate.
   */
  allowedDevOrigins: ['*.e2b.app', '*.e2b.dev'],

  /**
   * The browser must never call the API host directly: in a preview or deployed
   * environment the API is not reachable at `localhost` from the user's machine.
   * Client code therefore uses relative `/api/...` URLs, and Next proxies them
   * server-side to wherever the API actually runs.
   */
  async rewrites() {
    const apiBase = process.env.API_URL ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${apiBase}/api/:path*` }];
  },
};

export default nextConfig;
