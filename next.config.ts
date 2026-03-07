import type { NextConfig } from "next";

// 禁用自签证书的 SSL 校验拦截，以防止 fetch failed
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
};

export default nextConfig;
