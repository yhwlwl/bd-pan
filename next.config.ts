import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

// 禁用自签证书的 SSL 校验拦截，以防止 fetch failed
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Turbopack 可能会误判 workspace root（例如被上层目录的 lockfile 干扰），从而尝试读取无权限目录导致构建/启动失败。
const turbopackRoot = fileURLToPath(new URL(".", import.meta.url));

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  turbopack: {
    root: turbopackRoot,
  },
};

export default nextConfig;
