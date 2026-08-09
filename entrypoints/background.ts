import type { ProxyStorageConfig } from '../types/proxy';
import { generatePacScript } from '../utils/pac';
import { getProxyConfig, sanitizeProxyConfig } from '../utils/storage';

/** Chrome fixed_servers 支持的代理协议白名单 */
const FIXED_SERVER_SCHEMES = ['http', 'https', 'quic', 'socks4', 'socks5'];

export default defineBackground(() => {
  console.log('BBproxy Background Service Worker 已启动');

  /**
   * 安全转换 PAC 脚本
   */
  function safeGeneratePacScript(server: ProxyStorageConfig['server'], bypassRules: string[]): string {
    try {
      return generatePacScript(server, bypassRules || []);
    } catch (e) {
      console.error('[BBproxy] PAC 脚本生成异常，降级为 direct:', e);
      return 'function FindProxyForURL(url, host) { return "DIRECT"; }';
    }
  }

  /**
   * 将系统代理应用至 chrome.proxy.settings
   * 返回 Promise，调用方负责 catch，避免未处理的 Promise rejection
   */
  function applyProxySettings(config: ProxyStorageConfig): Promise<void> {
    const { currentMode, server, bypassRules } = config;
    const scheme = (server.scheme || 'socks5').toLowerCase();
    const port = Number(server.port);
    const host = (server.host || '').trim();
    let proxyConfig: chrome.proxy.ProxyConfig;

    if (currentMode === 'direct') {
      proxyConfig = { mode: 'direct' };
    } else if (currentMode === 'global') {
      proxyConfig = {
        mode: 'fixed_servers',
        rules: {
          singleProxy: {
            scheme: FIXED_SERVER_SCHEMES.includes(scheme) ? scheme : 'http',
            host: host || '127.0.0.1',
            port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 10808,
          },
          // bypassList 与 PAC 一样只接受 ASCII，非 ASCII 规则会致 Chrome 拒绝配置
          bypassList: (bypassRules || [])
            .map((r) => r.trim())
            .filter((r) => r.length > 0 && /^[\x00-\x7F]*$/.test(r)),
        },
      };
    } else if (currentMode === 'auto') {
      const scriptData = safeGeneratePacScript(server, bypassRules || []);
      proxyConfig = {
        mode: 'pac_script',
        pacScript: {
          data: scriptData,
          mandatory: false,
        },
      };
    } else {
      proxyConfig = { mode: 'direct' };
    }

    return new Promise<void>((resolve) => {
      chrome.proxy.settings.set(
        { value: proxyConfig, scope: 'regular' },
        () => {
          if (chrome.runtime.lastError) {
            console.error('[BBproxy] 代理切换失败:', chrome.runtime.lastError.message);
          } else {
            console.log(`[BBproxy] 代理已成功切换为模式: ${currentMode}`);
          }
          resolve();
        }
      );
    });
  }

  /**
   * 代理应用串行队列。
   * 防止启动时的 syncProxy（读取旧配置）与 storage.onChanged（新配置）并发应用，
   * 导致旧配置后完成而覆盖新配置（配置回滚竞态）。
   */
  let applyQueue: Promise<void> = Promise.resolve();

  function enqueueApply(config: ProxyStorageConfig): void {
    applyQueue = applyQueue
      .then(() => applyProxySettings(config))
      .catch((err) => {
        console.error('[BBproxy] 应用代理配置失败:', err);
      });
  }

  async function syncProxy() {
    try {
      const config = await getProxyConfig();
      enqueueApply(config);
    } catch (err) {
      console.error('[BBproxy] 同步代理配置异常:', err);
    }
  }

  /**
   * 处理存储变更：先清洗再应用，任何异常都被捕获
   */
  function handleConfigChange(rawConfig: unknown) {
    const sanitized = sanitizeProxyConfig(rawConfig);
    enqueueApply(sanitized);
  }

  // 1. Service Worker 启动或浏览器启动时立刻重新同步
  syncProxy();

  // 2. 初始化逻辑：当插件安装或更新时应用代理配置
  chrome.runtime.onInstalled.addListener(() => {
    syncProxy();
  });

  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      syncProxy();
    });
  }

  // 3. 实时监听配置变化
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.proxyConfig) {
      handleConfigChange(changes.proxyConfig.newValue);
    }
  });
});
