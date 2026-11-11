import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // The seed files must ship with the serverless functions so a fresh database can self-seed.
  outputFileTracingIncludes: {
    "/api/**": ["./data/seed/**"],
    "/dashboard/**": ["./data/seed/**"],
    "/data": ["./data/seed/**"],
    "/": ["./data/seed/**"],
  },
};

export default nextConfig;
