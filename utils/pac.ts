import type { ProxyServerConfig } from '../types/proxy';
import { MAX_BYPASS_RULES, MAX_HOST_LENGTH, MAX_RULE_LENGTH } from '../types/proxy';

/**
 * PAC 代理类型映射（sanitizeProxyConfig 仅放行 http/https/socks5）。
 * 依据 Chromium net/docs/proxy.md 的 PAC 标识符列表：支持 SOCKSv4/SOCKSv5/HTTPS/HTTP/DIRECT。
 * - http   → PROXY（PAC 中 HTTP 代理的标识符就是 PROXY）
 * - https  → HTTPS（官方示例即 `HTTPS proxy:8080`。若写成 PROXY，Chrome 会用明文 HTTP
 *            去连一个 TLS 端口，代理直接不可用——这不是"Chrome 拒绝该 PAC"）
 * - socks5 → SOCKS5
 */
const PAC_SCHEME_MAP: Record<string, string> = {
  http: 'PROXY',
  https: 'HTTPS',
  socks5: 'SOCKS5',
};

/** 主机名允许的字符（域名 / IPv4 / [IPv6]），防止恶意字符注入 PAC 脚本 */
const HOST_SAFE_PATTERN = /^[a-zA-Z0-9.\-_:[\]]+$/;

/** 非法字符（引号、反斜杠、控制字符等），注入 PAC 会破坏脚本语法 */
const HOST_STRIP_PATTERN = /["\\\r\n;]/g;

/**
 * 用户填写的代理主机名是否可直接使用（域名 / IPv4 / IPv6，IPv6 可裸写或带方括号）。
 * 与 sanitizeHost 共用同一套字符集与长度约束，作为唯一判定口径，避免出现
 * "storage 接受、应用时却被静默改写"的不一致（那会让面板显示一个主机、
 * 实际代理指向另一个主机，且毫无提示）。
 */
export function isUsableProxyHost(host: string | undefined): boolean {
  const trimmed = (host || '').trim();
  return trimmed.length > 0 && trimmed.length <= MAX_HOST_LENGTH && HOST_SAFE_PATTERN.test(trimmed);
}

/**
 * 清洗代理服务器 host，防止特殊字符注入 PAC 脚本。
 * 返回规范化后的主机名：含 ':' 的 IPv6 地址自动加方括号。
 * 两种模式都接受方括号写法：PAC 语法要求 `[::1]:10808`；chrome.proxy 的
 * fixed_servers 亦明确接受带括号的 IPv6（Chromium net/base/proxy_server.cc
 * 注释：Accepts IPv6 literal hosts with surrounding brackets or without），
 * 故两种模式共用一个规范化结果是安全的。
 * 注意：调用方（storage 的 sanitizeProxyConfig）已用 isUsableProxyHost 拦掉非法输入，
 * 这里保留剥离与回退属纵深防御。
 */
export function sanitizeHost(host: string | undefined): string {
  let safe = (host || '').trim().replace(HOST_STRIP_PATTERN, '');
  if (!isUsableProxyHost(safe)) {
    safe = '127.0.0.1';
  }
  if (safe.includes(':') && !safe.startsWith('[')) {
    safe = `[${safe}]`;
  }
  return safe;
}

/**
 * 校验并规整端口，仅接受 1-65535 的整数（非法回退 10808）
 */
export function sanitizePort(port: number | string | undefined): number {
  const num = Number(port);
  return Number.isInteger(num) && num >= 1 && num <= 65535 ? num : 10808;
}

/**
 * 清洗白名单规则：trim、丢弃空/非 ASCII/超长规则并限制总条数。
 * PAC 脚本与 fixed_servers bypassList 均只接受 ASCII（非 ASCII 会被 Chrome
 * 拒绝整个配置），storage 入口与两种模式共用本函数，保证行为一致。
 */
export function sanitizeBypassRules(rules: unknown[]): string[] {
  return rules
    .map((rule) => String(rule).trim())
    .filter((rule) => rule.length > 0 && rule.length <= MAX_RULE_LENGTH && /^[\x00-\x7F]*$/.test(rule))
    .slice(0, MAX_BYPASS_RULES);
}

/** 把一条规则归一化为「主机名匹配」形式：小写、去前导点 */
function normalizeRule(rawRule: string): string {
  return rawRule.replace(/^\./, '').toLowerCase();
}

/** 规则是否含通配符（* 或 ?） */
function isWildcard(rule: string): boolean {
  return rule.includes('*') || rule.includes('?');
}

/**
 * 把面板文本域的内容解析为规则数组：按行拆分、去首尾空白、丢空行、去重。
 * 单独抽出来是为了让它只有一个实现，并作为"任何一次保存都必须先执行"的入口，
 * 避免防抖定时器被别的输入取消时，用户刚敲进去的规则整批丢失。
 */
export function parseRulesText(text: string): string[] {
  const parsed = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return Array.from(new Set(parsed));
}

/**
 * 清洗并预分类规则，供 PAC 生成与 bypassList 翻译共用。
 * 两处若各写一份分类逻辑，一旦改动其中一处就会让两种模式的语义悄悄分叉。
 */
function classifyRules(rules: unknown[]): { exact: string[]; wildcard: string[] } {
  const exact: string[] = [];
  const wildcard: string[] = [];
  for (const rawRule of sanitizeBypassRules(rules)) {
    const rule = normalizeRule(rawRule);
    if (isWildcard(rule)) {
      wildcard.push(rule);
    } else {
      exact.push(rule);
    }
  }
  return { exact, wildcard };
}

/**
 * 把清洗后的规则翻译成 chrome.proxy fixed_servers 可用的 bypassList。
 *
 * 为什么要翻译而不能直接丢过去：
 * 官方文档规定 bypassList 中 "foobar.com" 只匹配 foobar.com 本身、**不匹配**子域，
 * 而 PAC 模式下 rule 会匹配自身与子域。两者若不翻译，同一份白名单在 Global 与 Auto
 * 两个模式下的分流结果会不一致（用户在两个模式间切换会看到行为悄悄变化）。
 * 故此处为每条普通规则补一条 "*." 前缀，使其与 PAC 的「自身 + 子域」语义对齐。
 *
 * 通配规则（192.168.* 等）两种模式的 * 语义一致，直接透传；
 * bypassList 不支持 ? 单字符通配，统一放宽为 * 以保证「写什么就直连什么」的意图。
 */
export function generateBypassList(rules: unknown[]): string[] {
  const { exact, wildcard } = classifyRules(rules);
  const out: string[] = [];
  for (const rule of exact) {
    out.push(rule, '*.' + rule);
  }
  for (const rule of wildcard) {
    out.push(rule.replace(/\?/g, '*'));
  }
  return out;
}

/** 把 shexp 通配模式转成等价的 RegExp 源码片段（仅转义正则元字符） */
function shexpToRegexSource(shexp: string): string {
  let out = '';
  for (const ch of shexp) {
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else if ('\\^$.|+()[]{}'.includes(ch)) out += '\\' + ch;
    else out += ch;
  }
  return out;
}

/**
 * 根据代理服务器配置、白名单规则与故障转移开关，生成标准 Chrome PAC 脚本。
 *
 * 性能与正确性设计说明（PAC 在浏览器网络栈热路径上，对每个请求同步执行）：
 * - Chromium 的 PAC 沙箱以 --jitless 运行（无 JIT、无正则 JIT），且内置的 shExpMatch
 *   每次调用都要做 3 次 replace + 一次 new RegExp()，代价极高。故这里在**生成时**
 *   预分类、**装载时**预编译：普通规则进哈希表做 O(1) 精确查询，通配规则各编译一次
 *   RegExp 复用。实测（node --jitless，2000 个主机、200 条规则）：判定耗时由
 *   257us/次 降到 15us/次，约 17 倍；30 条规则的常见规模由 42us/次 降到 3us/次。
 * - 不用内置 dnsDomainIs 做域名匹配：它的真实实现是纯字符串后缀比较
 *   （host.substring(host.length - domain.length) == domain），不看点边界，
 *   会把 notexample.com 误判给规则 example.com（Chromium 自己的 perf-test PAC
 *   就为此提供了替代函数）。这里改为手写的点边界判断 + 逐级去掉最左标签向上查找，
 *   既正确又只要 O(标签数) 次哈希查询。
 * - 哈希表用 Object.create(null) 创建，而非普通对象字面量。原因：host 经 toLowerCase()
 *   后仍全小写的 Object.prototype 成员只有 constructor 与 __proto__，规则若恰好叫这两个
 *   名字之一，字面量哈希表会让 exactSet["constructor"] 命中继承来的成员（真值），
 *   使名为该名字的主机被误判直连。Object.create(null) 无原型可继承，彻底消除该情形。
 */
export function generatePacScript(
  server: ProxyServerConfig,
  bypassRules: string[],
  fallbackDirect = false
): string {
  const pacProxyType = PAC_SCHEME_MAP[server.scheme] || 'PROXY';

  const safeHost = sanitizeHost(server.host);
  const safePort = sanitizePort(server.port);

  const { exact: exactRules, wildcard: wildRules } = classifyRules(bypassRules);
  const wildSources = wildRules.map(shexpToRegexSource);

  // 故障转移：代理不可达时改走直连，避免整机断网；代价是代理故障期间流量裸奔，
  // 故默认关闭，由用户显式开启。
  const proxyStr = `${pacProxyType} ${safeHost}:${safePort}${fallbackDirect ? '; DIRECT' : ''}`;

  const exactRulesJson = JSON.stringify(exactRules);
  const wildRulesJson = JSON.stringify(wildSources);

  // 注意：PAC 脚本内容必须保持纯 ASCII（Chrome 限制 pacScript.data 只接受 ASCII），
  // 因此本模板内不得出现任何非 ASCII 字符（含中文注释）。
  // safeHost 已由 sanitizeHost 规范化（IPv6 自动加方括号），此处直接拼接
  return `
var proxyStr = "${proxyStr}";
var exactRules = ${exactRulesJson};
var wildRegexps = [];
var exactSet = Object.create(null);

for (var i = 0; i < exactRules.length; i++) {
  exactSet[exactRules[i]] = 1;
}

var wildPatterns = ${wildRulesJson};
for (var i = 0; i < wildPatterns.length; i++) {
  wildRegexps.push(new RegExp("^" + wildPatterns[i] + "$"));
}

function FindProxyForURL(url, host) {
  host = host.toLowerCase();

  // strip a single trailing dot (FQDN form): Chrome passes "example.com." for
  // http://example.com./ and the whitelist entries would otherwise never match
  if (host.charAt(host.length - 1) === ".") {
    host = host.substring(0, host.length - 1);
  }

  // 1. exact match on the host itself
  if (exactSet[host]) {
    return "DIRECT";
  }

  // 2. walk up the parent domains: a rule "example.com" also covers
  //    "www.example.com" and "a.b.example.com", but never "notexample.com"
  var dot = host.indexOf(".");
  while (dot !== -1) {
    if (exactSet[host.substring(dot + 1)]) {
      return "DIRECT";
    }
    dot = host.indexOf(".", dot + 1);
  }

  // 3. wildcard match, patterns precompiled once at load time
  for (var i = 0; i < wildRegexps.length; i++) {
    if (wildRegexps[i].test(host)) {
      return "DIRECT";
    }
  }

  // all other requests go through the proxy
  return proxyStr;
}
`.trim();
}
