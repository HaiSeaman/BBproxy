import { describe, expect, it } from 'vitest';
import { sanitizeProxyConfig } from './storage';
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
});
