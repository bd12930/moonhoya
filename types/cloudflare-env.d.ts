/**
 * Augments the global CloudflareEnv interface declared by @opennextjs/cloudflare
 * with the bindings specific to this Moonhoya application.
 * These must match the bindings declared in wrangler.toml.
 */
declare global {
  interface CloudflareEnv {
    /** Cloudflare D1 database — primary data store */
    DB: D1Database;
    /** Cloudflare R2 bucket — plant photo storage */
    MOONHOYA_PHOTOS: R2Bucket;
  }
}

export {};
