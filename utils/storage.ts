import type { ProxyMode, ProxyScheme, ProxyStorageConfig } from '../types/proxy';
import {
  DEFAULT_PROXY_CONFIG,
  MAX_BYPASS_RULES,
  MAX_HOST_LENGTH,
  MAX_RULE_LENGTH,
} from '../types/proxy';

const STORAGE_KEY = 'proxyConfig';

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

  // 兼容旧版 rules 字段；过滤非 ASCII（PAC/bypassList 只接受 ASCII，中文域名需
  // Punycode 编码，此处直接丢弃非 ASCII 规则），并限制单条长度与总条数
  let bypassRules = r.bypassRules;
  if (!Array.isArray(bypassRules)) {
    bypassRules = Array.isArray(r.rules) ? r.rules : [...DEFAULT_PROXY_CONFIG.bypassRules];
  }
  bypassRules = bypassRules
    .map((rule: unknown) => String(rule).trim())
    .filter(
      (rule: string) =>
        rule.length > 0 && rule.length <= MAX_RULE_LENGTH && /^[\x00-\x7F]*$/.test(rule)
    )
    .slice(0, MAX_BYPASS_RULES);

  const rawMode = r.currentMode as ProxyMode | undefined;
  const rawScheme = String(r.server?.scheme ?? '').toLowerCase();
  const rawPort = Number(r.server?.port);
  const rawHost = typeof r.server?.host === 'string' ? r.server.host.trim() : '';

  return {
    currentMode: rawMode === 'direct' || rawMode === 'global' || rawMode === 'auto' ? rawMode : DEFAULT_PROXY_CONFIG.currentMode,
    server: {
      host: rawHost && rawHost.length <= MAX_HOST_LENGTH ? rawHost : DEFAULT_PROXY_CONFIG.server.host,
      port: Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535 ? rawPort : DEFAULT_PROXY_CONFIG.server.port,
      scheme: VALID_SCHEMES.includes(rawScheme as ProxyScheme)
        ? (rawScheme as ProxyScheme)
        : DEFAULT_PROXY_CONFIG.server.scheme,
    },
    bypassRules,
  };
}

/**
 * 获取当前的代理配置（如未设置则初始化并返回默认值）
 */
export async function getProxyConfig(): Promise<ProxyStorageConfig> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  if (!result[STORAGE_KEY]) {
    // 经 sanitize 深拷贝后再写入，避免默认配置对象被直接存入 storage 后遭外部修改
    const initial = sanitizeProxyConfig(DEFAULT_PROXY_CONFIG);
    await saveProxyConfig(initial);
    return initial;
  }
  return sanitizeProxyConfig(result[STORAGE_KEY]);
}

/**
 * 保存代理配置至 chrome.storage.local
 */
export async function saveProxyConfig(config: ProxyStorageConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
}
