import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents and partialPrefetching are not yet supported by
  // @opennextjs/cloudflare — keep them off so standard Next.js rendering applies.
};

export default nextConfig;
