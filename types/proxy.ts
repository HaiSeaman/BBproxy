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

/** 代理服务器 host 最大长度（RFC 1035 域名上限 253，IPv6 带方括号放宽到 255） */
export const MAX_HOST_LENGTH = 255;

/** 单条白名单规则最大长度 */
export const MAX_RULE_LENGTH = 255;

/** 白名单规则最大条数（超出截断，防止 PAC 脚本无界膨胀） */
export const MAX_BYPASS_RULES = 200;
