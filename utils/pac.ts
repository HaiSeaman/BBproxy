import type { ProxyServerConfig } from '../types/proxy';
import { MAX_BYPASS_RULES, MAX_HOST_LENGTH, MAX_RULE_LENGTH } from '../types/proxy';

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
 * 清洗代理服务器 host，防止特殊字符注入 PAC 脚本。
 * 返回规范化后的主机名：含 ':' 的 IPv6 地址自动加方括号（PAC 与
 * chrome.proxy fixed_servers 均要求 [IPv6] 形式，裸 ::1 会导致解析失败）。
 */
export function sanitizeHost(host: string | undefined): string {
  let safe = (host || '').trim().replace(HOST_STRIP_PATTERN, '');
  if (!HOST_SAFE_PATTERN.test(safe) || safe.length > MAX_HOST_LENGTH) {
    safe = '127.0.0.1';
  }
  if (safe.includes(':') && !safe.startsWith('[')) {
    safe = `[${safe}]`;
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
  // 同时限制单条长度与总条数，防止 PAC 脚本无界膨胀。
  const cleanBypassRules = (bypassRules || [])
    .map((r) => r.trim())
    .filter((r) => r.length > 0 && r.length <= MAX_RULE_LENGTH && /^[\x00-\x7F]*$/.test(r))
    .slice(0, MAX_BYPASS_RULES);

  // 预分类规则，避免 FindProxyForURL 每请求对每条规则重复做正则替换 / 字符串拼接。
  // PAC 是浏览器网络栈热路径，对每个网络请求都会执行，规则越多收益越大：
  // - plainRules：不含通配符的规则（精确域名/IP + 子域匹配），运行时只需一次 dnsDomainIs
  // - wildRules：含通配符（* 或 ?）的规则（192.168.* / 10.0.0.? 等），运行时只需一次
  //   shExpMatch；原逻辑会对通配规则额外尝试 "*.rule"（匹配子域），此处生成时预拼接好该变体
  const plainRules: string[] = [];
  const wildRules: string[] = [];
  for (const rawRule of cleanBypassRules) {
    // strip leading dot, e.g. .google.com -> google.com
    const rule = rawRule.replace(/^\./, '');
    if (rule.includes('*') || rule.includes('?')) {
      wildRules.push(rule);
      // 原逻辑会对通配规则额外尝试 "*." + cleanRule（匹配其子域），生成时预拼接好该变体
      wildRules.push('*.' + rule);
    } else {
      plainRules.push(rule);
    }
  }

  const plainRulesJson = JSON.stringify(plainRules);
  const wildRulesJson = JSON.stringify(wildRules);

  // 注意：PAC 脚本内容必须保持纯 ASCII（Chrome 限制 pacScript.data 只接受 ASCII），
  // 因此本模板内不得出现任何非 ASCII 字符（含中文注释）。
  // safeHost 已由 sanitizeHost 规范化（IPv6 自动加方括号），此处直接拼接
  return `
var proxyStr = "${pacProxyType} ${safeHost}:${safePort}";
var plainRules = ${plainRulesJson};
var wildRules = ${wildRulesJson};

function FindProxyForURL(url, host) {
  // 1. exact / domain / subdomain match (dnsDomainIs covers host === rule)
  for (var i = 0; i < plainRules.length; i++) {
    if (dnsDomainIs(host, plainRules[i])) {
      return "DIRECT";
    }
  }

  // 2. wildcard match (e.g. 192.168.* / *.local / 10.*.*.*)
  for (var i = 0; i < wildRules.length; i++) {
    if (shExpMatch(host, wildRules[i])) {
      return "DIRECT";
    }
  }

  // all other requests go through the proxy
  return proxyStr;
}
`.trim();
}
