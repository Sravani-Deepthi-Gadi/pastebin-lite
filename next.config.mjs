/** @type {import('next').NextConfig} */
const nextConfig = {
  // Database drivers are native/WASM modules: keep them out of the bundler so
  // they are required at runtime instead of being traced and inlined.
  serverExternalPackages: ['pg', '@electric-sql/pglite'],
  poweredByHeader: false,
};

export default nextConfig;
