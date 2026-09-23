/**
 * 测试夹具：复刻 Chromium 真实的 PAC 运行时所需的全部内置函数。
 *
 * 为什么必须用"真身"而不是自己写个近似版：
 * 曾有一版测试把 dnsDomainIs 手写成 `host === domain || host.endsWith('.' + domain)`，
 * 比 Chromium 真实实现严格，导致"规则 example.com 会误吞 notexample.com"这个真机 BUG
 * 在测试里永远是绿的。夹具背离现实 = 测试变成安慰剂。
 *
 * 当前生成的 PAC 不再调用任何 PAC 内置函数（改用哈希表与预编译正则），
 * 因此这里只保留被测试断言到的那一个，其余按需再加。
 */

/** 逐字取自 Chromium services/proxy_resolver/pac_js_library.h 的实现 */
export function dnsDomainIs(host: string, domain: string): boolean {
  return host.length >= domain.length && host.substring(host.length - domain.length) === domain;
}

const BUILTINS = { dnsDomainIs };

/**
 * 把 PAC 脚本文本装载为可执行的 FindProxyForURL，并注入 Chromium 内置函数。
 */
export function loadPacScript(script: string): (url: string, host: string) => string {
  const names = Object.keys(BUILTINS);
  const values = names.map((n) => (BUILTINS as Record<string, unknown>)[n]);
  const factory = new Function(
    ...names,
    script + '\nreturn FindProxyForURL;'
  ) as (...args: unknown[]) => (url: string, host: string) => string;
  return factory(...values);
}
