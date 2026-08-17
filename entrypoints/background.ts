import type { ProxyStorageConfig } from '../types/proxy';
import { generatePacScript, sanitizeHost, sanitizePort } from '../utils/pac';
import { getProxyConfig, PROXY_ERROR_KEY, sanitizeProxyConfig, STORAGE_KEY } from '../utils/storage';

/** chrome.proxy.settings.set 回调兜底超时（ms）：防止极端情况下队列永久阻塞 */
const APPLY_TIMEOUT_MS = 5000;

/** onProxyError 写 storage 的限流间隔（ms）：代理错误对每个失败请求都会触发 */
const ERROR_WRITE_THROTTLE_MS = 2000;

export default defineBackground(() => {
  console.log('BBproxy Background Service Worker 已启动');

  /**
   * 将系统代理应用至 chrome.proxy.settings
   * 返回 Promise，调用方负责 catch，避免未处理的 Promise rejection
   */
  function applyProxySettings(config: ProxyStorageConfig): Promise<void> {
    const { currentMode, server, bypassRules } = config;
    let proxyConfig: chrome.proxy.ProxyConfig;

    // currentMode 经 sanitize 后只有 3 个合法值；else 同时覆盖 direct 与意外值兜底
    if (currentMode === 'global') {
      proxyConfig = {
        mode: 'fixed_servers',
        rules: {
          // 入队配置必经 sanitizeProxyConfig 清洗：scheme ∈ {http,https,socks5}
          // （均为 fixed_servers 合法值），bypassRules 已 trim、纯 ASCII、限长限条数
          singleProxy: {
            scheme: server.scheme,
            // 与 PAC 模式共用同一套 host 清洗（含 IPv6 括号规范化），
            // 避免两种模式对非法 host 的行为不一致（fixed_servers 无清洗时 set 直接失败）
            host: sanitizeHost(server.host),
            port: sanitizePort(server.port),
          },
          bypassList: bypassRules,
        },
      };
    } else if (currentMode === 'auto') {
      proxyConfig = {
        mode: 'pac_script',
        pacScript: {
          data: generatePacScript(server, bypassRules),
        },
      };
    } else {
      proxyConfig = { mode: 'direct' };
    }

    return new Promise<void>((resolve) => {
      // 兜底超时：极端情况下（SW 被终止等）set 回调可能永不触发，
      // 超时后释放队列，避免后续所有配置应用被永久阻塞。
      // 回调之后触发时 resolve 是幂等的，无副作用。
      const timeout = setTimeout(() => {
        console.warn(`[BBproxy] 代理设置超时（${APPLY_TIMEOUT_MS}ms），跳过本次应用: ${currentMode}`);
        resolve();
      }, APPLY_TIMEOUT_MS);

      chrome.proxy.settings.set(
        { value: proxyConfig, scope: 'regular' },
        () => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            console.error('[BBproxy] 代理切换失败:', chrome.runtime.lastError.message);
          } else {
            console.log(`[BBproxy] 代理已成功切换为模式: ${currentMode}`);
            // 配置应用成功后清除历史代理错误（错误是瞬态状态，针对旧配置，
            // 不清除会导致 popup 一直展示早已失效的错误提示）
            chrome.storage.local.remove(PROXY_ERROR_KEY).catch((err) =>
              console.error('[BBproxy] 清除代理错误信息失败:', err)
            );
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
   * 队列只保留最新配置：连续多次变更时，积压的中间态被最新值覆盖，
   * 减少冗余的 chrome.proxy.settings.set IPC 调用；串行执行保持不变。
   */
  let applyQueue: Promise<void> = Promise.resolve();
  let latestConfig: ProxyStorageConfig | null = null;

  function enqueueApply(config: ProxyStorageConfig): void {
    latestConfig = config;
    applyQueue = applyQueue
      .then(async () => {
        if (!latestConfig) return;
        const cfg = latestConfig;
        latestConfig = null;
        await applyProxySettings(cfg);
      })
      .catch((err) => {
        console.error('[BBproxy] 应用代理配置失败:', err);
      });
  }

  /**
   * 同步读取入口的竞态保护。
   * syncProxy（SW 冷启动时的顶层调用）通过 storage 读取配置，是异步的；
   * 若读取期间用户恰好在 popup 修改配置，storage.onChanged 会入队新值。
   * 若 syncProxy 此时仍把读到的旧值入队，会覆盖 latestConfig 并应用旧配置（回滚竞态）。
   * 通过标志让“变更事件”接管：读取期间发生过 onChanged 就直接放弃本次同步，
   * 因为变更事件已入队最新配置，storage 中的值也已被事件处理。
   */
  let changedSinceSync = false;

  async function syncProxy() {
    try {
      changedSinceSync = false;
      const config = await getProxyConfig();
      if (changedSinceSync) return;
      enqueueApply(config);
    } catch (err) {
      console.error('[BBproxy] 同步代理配置异常:', err);
    }
  }

  /**
   * 处理存储变更：先清洗再应用，任何异常都被捕获
   */
  function handleConfigChange(rawConfig: unknown) {
    changedSinceSync = true;
    const sanitized = sanitizeProxyConfig(rawConfig);
    enqueueApply(sanitized);
  }

  // SW 每次启动（含安装/更新/浏览器启动/事件唤醒）都会先执行顶层代码，
  // syncProxy 必然先于任何事件回调运行，故无需再注册 onInstalled/onStartup。
  syncProxy();

  // 1. 实时监听配置变化
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[STORAGE_KEY]) {
      handleConfigChange(changes[STORAGE_KEY].newValue);
    }
  });

  // 2. 监听代理运行错误（如代理服务器不可达），写入 storage 供 popup 展示。
  // 该事件会对每个失败请求重复触发，因此做限流，只保留最近一次错误。
  let lastErrorWrite = 0;
  chrome.proxy.onProxyError.addListener((details) => {
    const now = Date.now();
    if (now - lastErrorWrite < ERROR_WRITE_THROTTLE_MS) return;
    lastErrorWrite = now;

    const error = typeof details.error === 'string' ? details.error : '未知代理错误';
    chrome.storage.local
      .set({ [PROXY_ERROR_KEY]: { error } })
      .catch((err) => console.error('[BBproxy] 写入代理错误信息失败:', err));
  });
});
