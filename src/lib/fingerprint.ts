/**
 * 设备码工具 — 服务端规范化
 *
 * 设备码现在由浏览器首次访问时生成的随机 ID 提供，并保存在本地存储中。
 * 它不是认证凭据，只用于把同一浏览器的风险事件串起来；账号和服务端 IP 才是硬校验维度。
 */
import crypto from 'crypto';

/**
 * 兼容旧调用的服务端兜底指纹。新风控链路不再调用它，因为把 IP 放进设备指纹
 * 会导致用户换网后产生新设备、共享出口又会把多个用户错误合并。
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
  const value = raw?.trim() || '';
  if (value.length < 8 || value.length > 200) return null;
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/**
 * 验证 + 规范化设备码
 * 返回 { deviceCode, hash }，不合法则返回 null
 */
export function normalizeDeviceCode(raw: string | undefined | null): { deviceCode: string; hash: string } | null {
  const value = raw?.trim() || '';
  if (value.length < 8 || value.length > 200) return null;
  const deviceCode = value;
  const hash = crypto.createHash('sha256').update(deviceCode).digest('hex').slice(0, 16);
  return { deviceCode, hash };
}


