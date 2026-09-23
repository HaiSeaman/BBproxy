import type { ProxyMode, ProxyScheme, ProxyStorageConfig } from '../types/proxy';
import { DEFAULT_PROXY_CONFIG } from '../types/proxy';
import { isUsableProxyHost, sanitizeBypassRules, sanitizePort } from './pac';

/** 代理配置存储键：popup 写入、background 读取并按它过滤 onChanged 事件 */
export const STORAGE_KEY = 'proxyConfig';

/** 代理错误信息存储键：background 写入，popup 读取展示 */
export const PROXY_ERROR_KEY = 'proxyError';

const VALID_MODES: ProxyMode[] = ['direct', 'global', 'auto'];
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
      fallbackDirect: DEFAULT_PROXY_CONFIG.fallbackDirect,
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
    currentMode: VALID_MODES.includes(rawMode as ProxyMode)
      ? (rawMode as ProxyMode)
      : DEFAULT_PROXY_CONFIG.currentMode,
    server: {
      // 与 sanitizeHost 同一判定口径：会被清洗改写的输入直接回退默认，
      // 不允许"存下一个主机、应用时静默换成另一个主机"
      host: isUsableProxyHost(rawHost) ? rawHost : DEFAULT_PROXY_CONFIG.server.host,
      port: sanitizePort(r.server?.port),
      scheme: VALID_SCHEMES.includes(rawScheme as ProxyScheme)
        ? (rawScheme as ProxyScheme)
        : DEFAULT_PROXY_CONFIG.server.scheme,
    },
    bypassRules,
    // 只认布尔 true，脏数据（'true' / 1 / 对象）一律视为关闭，避免静默开启裸奔
    fallbackDirect: r.fallbackDirect === true,
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
 * 把配置展开为普通对象，用于写入 storage。
 * 面板里的 config 是 Vue 的响应式代理，直接写会让代理对象参与序列化；
 * 这里集中一处展开，调用方（面板）就不必各自维护一份手写字段清单。
 * 返回类型是 ProxyStorageConfig，故漏字段会在编译期报错，不会静默丢字段。
 */
export function toPlainConfig(config: ProxyStorageConfig): ProxyStorageConfig {
  return {
    currentMode: config.currentMode,
    server: { ...config.server },
    bypassRules: [...config.bypassRules],
    fallbackDirect: config.fallbackDirect,
  };
}

/**
 * 保存代理配置至 chrome.storage.local
 */
export async function saveProxyConfig(config: ProxyStorageConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: toPlainConfig(config) });
}

/**
 * 面板打开时的单次读取：一次 IPC 同时取回配置与代理错误。
 * 提供这个入口是为了让面板能"先读完再挂载"——面板若先用默认值渲染、
 * 等异步读回再覆盖，用户在这段空窗里操作控件就会把默认值当成真实配置写回去，
 * 从而覆盖掉用户自己的主机/端口/白名单。合并读取顺带省掉一次 IPC 往返。
 */
export async function loadPopupState(): Promise<{ config: ProxyStorageConfig; error: string }> {
  const result = await chrome.storage.local.get([STORAGE_KEY, PROXY_ERROR_KEY]);
  const info = result[PROXY_ERROR_KEY];
  return {
    config: sanitizeProxyConfig(result[STORAGE_KEY]),
    error: info && typeof info.error === 'string' ? info.error : '',
  };
}
