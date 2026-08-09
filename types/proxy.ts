export type ProxyMode = 'direct' | 'global' | 'auto';

export type ProxyScheme = 'http' | 'https' | 'socks5';

export interface ProxyServerConfig {
  host: string;
  port: number;
  scheme: ProxyScheme;
}

export interface ProxyStorageConfig {
  currentMode: ProxyMode;
  server: ProxyServerConfig;
  bypassRules: string[]; // 白名单规则列表：匹配到的 IP/网段/域名不走代理，直接直连 DIRECT
}

export const DEFAULT_PROXY_CONFIG: ProxyStorageConfig = {
  currentMode: 'direct',
  server: {
    host: '127.0.0.1',
    port: 10808,
    scheme: 'socks5',
  },
  bypassRules: ['localhost', '127.0.0.1', '192.168.*'],
};
