import type { ProxyServerConfig } from '../types/proxy';

/**
 * PAC 代理类型映射。
 * Chrome PAC 脚本仅支持 DIRECT / PROXY / SOCKS / SOCKS4 / SOCKS5：
 * - http  → PROXY
 * - https → PROXY（HTTPS 代理实际通过 CONNECT 隧道，PAC 中必须写作 PROXY，否则 Chrome 拒绝该 PAC）
 * - socks4 → SOCKS4
 * - socks5 → SOCKS5
 */
const PAC_SCHEME_MAP: Record<string, string> = {
  http: 'PROXY',
  https: 'PROXY',
  socks4: 'SOCKS4',
  socks5: 'SOCKS5',
};

/** 主机名允许的字符（域名 / IPv4 / [IPv6]），防止恶意字符注入 PAC 脚本 */
const HOST_SAFE_PATTERN = /^[a-zA-Z0-9.\-_:[\]]+$/;

/** 非法字符（引号、反斜杠、控制字符等），注入 PAC 会破坏脚本语法 */
const HOST_STRIP_PATTERN = /["\\\r\n;]/g;

/**
 * 清洗代理服务器 host，防止特殊字符注入 PAC 脚本
 */
function sanitizeHost(host: string | undefined): string {
  let safe = (host || '').trim().replace(HOST_STRIP_PATTERN, '');
  if (!HOST_SAFE_PATTERN.test(safe)) {
    safe = '127.0.0.1';
  }
  return safe;
}

/**
 * 校验并规整端口，仅接受 1-65535 的整数
 */
function sanitizePort(port: number | string | undefined): number {
  const num = Number(port);
  return Number.isInteger(num) && num >= 1 && num <= 65535 ? num : 10808;
}

/**
 * 根据代理服务器配置和白名单规则列表，生成标准 Chrome PAC 脚本
 * @param server 代理服务器配置 (host, port, scheme)
 * @param bypassRules 白名单规则数组 (如 ["localhost", "127.0.0.1", "192.168.*"])
 * @returns 符合 PAC 规范的 JS 字符串
 */
export function generatePacScript(server: ProxyServerConfig, bypassRules: string[]): string {
  const scheme = (server.scheme || 'socks5').toLowerCase();
  const pacProxyType = PAC_SCHEME_MAP[scheme] || 'PROXY';

  const safeHost = sanitizeHost(server.host);
  const safePort = sanitizePort(server.port);

  // 过滤并清理规则（JSON.stringify 会正确转义引号/反斜杠，注入安全）。
  // 注意：PAC 脚本只允许 ASCII，包含非 ASCII 字符（如中文域名）的规则会导致
  // Chrome 拒绝整个 PAC（'pacScript.data' supports only ASCII code），故直接丢弃。
  const cleanBypassRules = (bypassRules || [])
    .map((r) => r.trim())
    .filter((r) => r.length > 0 && /^[\x00-\x7F]*$/.test(r));

  const bypassRulesJson = JSON.stringify(cleanBypassRules);

  // 注意：PAC 脚本内容必须保持纯 ASCII（Chrome 限制 pacScript.data 只接受 ASCII），
  // 因此本模板内不得出现任何非 ASCII 字符（含中文注释）。
  return `
function FindProxyForURL(url, host) {
  var bypassRules = ${bypassRulesJson};
  var proxyStr = "${pacProxyType} ${safeHost}:${safePort}";

  // loop over bypass rules
  for (var i = 0; i < bypassRules.length; i++) {
    var rule = bypassRules[i];
    if (!rule) continue;

    // strip leading dot, e.g. .google.com -> google.com
    var cleanRule = rule.replace(/^\\./, '');

    // 1. exact match
    if (host === rule || host === cleanRule) {
      return "DIRECT";
    }

    // 2. wildcard match (e.g. 192.168.* / *.local / 10.*.*.*)
    if (shExpMatch(host, rule) || shExpMatch(host, cleanRule)) {
      return "DIRECT";
    }

    // 3. domain and subdomain match
    if (dnsDomainIs(host, cleanRule) || shExpMatch(host, "*." + cleanRule)) {
      return "DIRECT";
    }
  }

  // all other requests go through the proxy
  return proxyStr;
}
`.trim();
}
