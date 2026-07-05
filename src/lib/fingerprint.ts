/**
 * 设备码工具 — 服务端指纹计算
 *
 * 浏览器端 computeDeviceCode() 算法相同，分别在 page.tsx 和 403.html 中独立实现（纯 JS/TS，无依赖）。
 * 算法：Canvas + WebGL + 屏幕 + 平台 + 时区 + CPU + 内存 + 语言 → FNV-1a 64bit hash
 */
import crypto from 'crypto';

/**
 * 服务端兜底指纹 — 当客户端无 JS 无法计算设备码时使用
 * 基于 IP + UA + Accept-Language 的 SHA256 hash
 */
export function computeServerFallback(ip: string, ua: string, acceptLanguage: string): string {
  const input = [ip, ua, acceptLanguage].join('|||');
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * 将客户端提供的设备码规范化（SHA256 后截取前 16 位 hex）
 * 用于数据库索引和去重
 */
export function hashDeviceCode(raw: string): string | null {
  if (!raw || raw.length < 8) return null;
  return crypto.createHash('sha256').update(raw.trim()).digest('hex').slice(0, 16);
}

/**
 * 验证 + 规范化设备码
 * 返回 { deviceCode, hash }，不合法则返回 null
 */
export function normalizeDeviceCode(raw: string | undefined | null): { deviceCode: string; hash: string } | null {
  if (!raw || raw.length < 8 || raw.length > 500) return null;
  const deviceCode = raw.trim().slice(0, 200);
  const hash = crypto.createHash('sha256').update(deviceCode).digest('hex').slice(0, 16);
  return { deviceCode, hash };
}
