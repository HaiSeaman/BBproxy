import type { ProxyMode, ProxyScheme, ProxyStorageConfig } from '../types/proxy';
import { DEFAULT_PROXY_CONFIG, MAX_HOST_LENGTH } from '../types/proxy';
import { sanitizeBypassRules, sanitizePort } from './pac';

/** 代理配置存储键：popup 写入、background 读取并按它过滤 onChanged 事件 */
export const STORAGE_KEY = 'proxyConfig';

/** 代理错误信息存储键：background 写入，popup 读取展示 */
export const PROXY_ERROR_KEY = 'proxyError';

const VALID_SCHEMES: ProxyScheme[] = ['http', 'https', 'socks5'];

/**
 * 将任意来源的配置清洗为结构完整、值合法的 ProxyStorageConfig。
 * 用于 storage 读取、storage.onChanged 变更等所有入口，避免脏数据导致
 * background 运行时抛错（如 server 缺失、scheme 非法、端口越界）。
 */
export function sanitizeProxyConfig(raw: unknown): ProxyStorageConfig {
  if (!raw || typeof raw !== 'object') {
    // 深拷贝，避免调用方修改返回值污染 DEFAULT_PROXY_CONFIG
    return {
      currentMode: DEFAULT_PROXY_CONFIG.currentMode,
      server: { ...DEFAULT_PROXY_CONFIG.server },
      bypassRules: [...DEFAULT_PROXY_CONFIG.bypassRules],
    };
  }

  const r = raw as Partial<ProxyStorageConfig> & Record<string, any>;

  // 规则清洗（trim/非 ASCII/限长/限条数）统一走 sanitizeBypassRules，与 PAC 生成共用
  const bypassRules = Array.isArray(r.bypassRules)
    ? sanitizeBypassRules(r.bypassRules)
    : [...DEFAULT_PROXY_CONFIG.bypassRules];

  const rawMode = r.currentMode as ProxyMode | undefined;
  const rawScheme = String(r.server?.scheme ?? '').toLowerCase();
  const rawHost = typeof r.server?.host === 'string' ? r.server.host.trim() : '';

  return {
    currentMode: rawMode === 'direct' || rawMode === 'global' || rawMode === 'auto' ? rawMode : DEFAULT_PROXY_CONFIG.currentMode,
    server: {
      host: rawHost && rawHost.length <= MAX_HOST_LENGTH ? rawHost : DEFAULT_PROXY_CONFIG.server.host,
      port: sanitizePort(r.server?.port),
      scheme: VALID_SCHEMES.includes(rawScheme as ProxyScheme)
        ? (rawScheme as ProxyScheme)
        : DEFAULT_PROXY_CONFIG.server.scheme,
    },
    bypassRules,
  };
}

/**
 * 获取当前的代理配置（缺省/脏数据统一经 sanitize 返回合法配置）。
 * 不做"首次写入默认值"：读取方行为一致，还省掉一次触发 onChanged 的冗余写。
 */
export async function getProxyConfig(): Promise<ProxyStorageConfig> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeProxyConfig(result[STORAGE_KEY]);
}

/**
 * 保存代理配置至 chrome.storage.local
 */
export async function saveProxyConfig(config: ProxyStorageConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
}
