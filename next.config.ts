import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Veritas is intentionally dependency-light; no special config needed yet.
  // Images are unoptimized because V1.0 ships no user-uploaded imagery and
  // OG images are generated at the edge.
  images: { unoptimized: true },
};

export default nextConfig;
