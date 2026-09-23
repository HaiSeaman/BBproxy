import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPopupState, sanitizeProxyConfig } from './storage';
import { DEFAULT_PROXY_CONFIG, MAX_BYPASS_RULES, MAX_HOST_LENGTH, MAX_RULE_LENGTH } from '../types/proxy';

describe('sanitizeProxyConfig', () => {
  it('null / undefined / 非对象返回默认配置', () => {
    for (const raw of [null, undefined, 42, 'str', []]) {
      const cfg = sanitizeProxyConfig(raw);
      expect(cfg.currentMode).toBe(DEFAULT_PROXY_CONFIG.currentMode);
      expect(cfg.server).toEqual(DEFAULT_PROXY_CONFIG.server);
      expect(cfg.bypassRules).toEqual(DEFAULT_PROXY_CONFIG.bypassRules);
    }
  });

  it('返回默认配置是深拷贝，修改返回值不污染默认值', () => {
    const cfg = sanitizeProxyConfig(null);
    cfg.server.host = 'evil';
    cfg.bypassRules.push('x');
    expect(DEFAULT_PROXY_CONFIG.server.host).toBe('127.0.0.1');
    expect(DEFAULT_PROXY_CONFIG.bypassRules).not.toContain('x');
  });

  it('非法 mode 回退默认（direct）', () => {
    const cfg = sanitizeProxyConfig({ currentMode: 'pac' as never });
    expect(cfg.currentMode).toBe('direct');
  });

  it('合法 mode 保留', () => {
    expect(sanitizeProxyConfig({ currentMode: 'global' }).currentMode).toBe('global');
    expect(sanitizeProxyConfig({ currentMode: 'auto' }).currentMode).toBe('auto');
  });

  it('非法 scheme 回退 socks5', () => {
    const cfg = sanitizeProxyConfig({ server: { scheme: 'ftp' } });
    expect(cfg.server.scheme).toBe('socks5');
  });

  it('端口越界 / 非整数回退默认端口', () => {
    expect(sanitizeProxyConfig({ server: { port: 0 } }).server.port).toBe(
      DEFAULT_PROXY_CONFIG.server.port
    );
    expect(sanitizeProxyConfig({ server: { port: 65536 } }).server.port).toBe(
      DEFAULT_PROXY_CONFIG.server.port
    );
    expect(sanitizeProxyConfig({ server: { port: 'abc' } }).server.port).toBe(
      DEFAULT_PROXY_CONFIG.server.port
    );
    expect(sanitizeProxyConfig({ server: { port: 8080 } }).server.port).toBe(8080);
  });

  it(`host 超过 ${MAX_HOST_LENGTH} 字符回退默认`, () => {
    const cfg = sanitizeProxyConfig({ server: { host: 'a'.repeat(MAX_HOST_LENGTH + 1) } });
    expect(cfg.server.host).toBe(DEFAULT_PROXY_CONFIG.server.host);
  });

  it('host 做 trim', () => {
    expect(sanitizeProxyConfig({ server: { host: '  proxy.local  ' } }).server.host).toBe(
      'proxy.local'
    );
  });

  it('规则：非 ASCII / 空白 / 超长被过滤，并 trim', () => {
    const cfg = sanitizeProxyConfig({
      bypassRules: ['  localhost  ', '', '中文.com', 'x'.repeat(MAX_RULE_LENGTH + 1), 'ok.com'],
    });
    expect(cfg.bypassRules).toEqual(['localhost', 'ok.com']);
  });

  it(`规则超过 ${MAX_BYPASS_RULES} 条时截断`, () => {
    const rules = Array.from({ length: MAX_BYPASS_RULES + 10 }, (_, i) => `r${i}.com`);
    const cfg = sanitizeProxyConfig({ bypassRules: rules });
    expect(cfg.bypassRules.length).toBe(MAX_BYPASS_RULES);
  });

  it('server 缺失时使用默认 server', () => {
    const cfg = sanitizeProxyConfig({ currentMode: 'auto' });
    expect(cfg.server).toEqual(DEFAULT_PROXY_CONFIG.server);
  });

  it('fallbackDirect 缺失时默认 false（故障转移必须显式开启）', () => {
    expect(sanitizeProxyConfig({ currentMode: 'auto' }).fallbackDirect).toBe(false);
    expect(sanitizeProxyConfig(null).fallbackDirect).toBe(false);
  });

  it('fallbackDirect 仅接受布尔 true', () => {
    expect(sanitizeProxyConfig({ fallbackDirect: true }).fallbackDirect).toBe(true);
    expect(sanitizeProxyConfig({ fallbackDirect: false }).fallbackDirect).toBe(false);
    // 脏数据（字符串 'true'、数字 1、对象）不得被当作开启，否则会静默让流量裸奔
    expect(sanitizeProxyConfig({ fallbackDirect: 'true' as never }).fallbackDirect).toBe(false);
    expect(sanitizeProxyConfig({ fallbackDirect: 1 as never }).fallbackDirect).toBe(false);
  });

  it('host 合法性口径与 sanitizeHost 一致：会被改写的输入直接回退默认', () => {
    // 旧行为是"原样存下 my proxy，应用时才被静默改成 127.0.0.1"，
    // 结果面板显示 my proxy、实际代理指向本机，且没有任何提示
    expect(sanitizeProxyConfig({ server: { host: 'my proxy' } }).server.host).toBe(
      DEFAULT_PROXY_CONFIG.server.host
    );
    expect(sanitizeProxyConfig({ server: { host: 'evil"quote' } }).server.host).toBe(
      DEFAULT_PROXY_CONFIG.server.host
    );
  });

  it('合法 host 原样保留（IPv6 裸写保留，应用时才补方括号）', () => {
    expect(sanitizeProxyConfig({ server: { host: 'proxy.example.com' } }).server.host).toBe(
      'proxy.example.com'
    );
    expect(sanitizeProxyConfig({ server: { host: '::1' } }).server.host).toBe('::1');
  });
});

describe('loadPopupState（面板打开时的单次读取）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('一次 IPC 同时取出配置与代理错误，且都经清洗', () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (keys: string[]) => {
            // 断言只请求一次、且把两个键一次取回（旧的两次串行读取是多余的往返）
            expect(keys).toHaveLength(2);
            return {
              proxyConfig: { currentMode: 'auto', server: { host: 'proxy.local', port: 1080, scheme: 'http' } },
              proxyError: { error: '代理不可达' },
            };
          }),
        },
      },
    });

    return loadPopupState().then((state) => {
      expect(state.config.currentMode).toBe('auto');
      expect(state.config.server.host).toBe('proxy.local');
      expect(state.error).toBe('代理不可达');
    });
  });

  it('storage 为空时回退默认配置，错误为空串', async () => {
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn(async () => ({})) } },
    });

    const state = await loadPopupState();
    expect(state.config).toEqual(DEFAULT_PROXY_CONFIG);
    expect(state.error).toBe('');
  });

  it('错误字段形状不对时不抛异常，只当作没有错误', async () => {
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn(async () => ({ proxyError: { error: 42 } })) } },
    });

    expect((await loadPopupState()).error).toBe('');
  });
});
