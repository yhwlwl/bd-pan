import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

// Turbopack 可能会误判 workspace root（例如被上层目录的 lockfile 干扰），从而尝试读取无权限目录导致构建/启动失败。
const turbopackRoot = fileURLToPath(new URL(".", import.meta.url));

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {
    root: turbopackRoot,
  },
  async headers() {
    return [
      { source: '/pdfjs/:path*.mjs', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    ];
  },
};

export default nextConfig;
