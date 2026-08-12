import { describe, expect, it } from 'vitest';
import { generatePacScript, sanitizeHost } from './pac';
import { MAX_BYPASS_RULES, MAX_RULE_LENGTH } from '../types/proxy';

const SERVER = { host: '127.0.0.1', port: 10808, scheme: 'socks5' as const };

/** 模拟 PAC 运行时环境（shExpMatch / dnsDomainIs），执行生成的 FindProxyForURL */
function loadPac(script: string) {
  const shExpMatch = (str: string, shexp: string) => {
    let re = '';
    for (const ch of shexp) {
      if (ch === '*') re += '.*';
      else if (ch === '?') re += '.';
      else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + re + '$').test(str);
  };
  const dnsDomainIs = (host: string, domain: string) =>
    host === domain || host.endsWith('.' + domain);
  const fn = new Function(
    'shExpMatch',
    'dnsDomainIs',
    script + '\nreturn FindProxyForURL;'
  ) as (sh: typeof shExpMatch, dd: typeof dnsDomainIs) => (url: string, host: string) => string;
  return fn(shExpMatch, dnsDomainIs);
}

function decision(rules: string[], host: string): string {
  return loadPac(generatePacScript(SERVER, rules))('http://' + host, host);
}

describe('generatePacScript', () => {
  describe('通配符规则（回归测试：曾因预分类漏判 ? 而失效）', () => {
    it('? 单字符通配符应匹配 DIRECT', () => {
      expect(decision(['10.0.0.?'], '10.0.0.1')).toBe('DIRECT');
      expect(decision(['10.0.0.?'], '10.0.0.a')).toBe('DIRECT');
      expect(decision(['a?c.example.com'], 'abc.example.com')).toBe('DIRECT');
    });

    it('? 通配符不应匹配多位或多于一位', () => {
      expect(decision(['10.0.0.?'], '10.0.0.12')).toBe(SERVER_PROXY_STR());
      expect(decision(['10.0.0.?'], '10.0.0.')).toBe(SERVER_PROXY_STR());
    });

    it('* 通配符匹配任意字符', () => {
      expect(decision(['192.168.*'], '192.168.1.5')).toBe('DIRECT');
      expect(decision(['192.168.*'], '10.0.0.1')).toBe(SERVER_PROXY_STR());
    });
  });

  describe('精确域名 / 子域匹配', () => {
    it('规则域名匹配自身与子域', () => {
      expect(decision(['example.com'], 'example.com')).toBe('DIRECT');
      expect(decision(['example.com'], 'www.example.com')).toBe('DIRECT');
      expect(decision(['example.com'], 'deep.a.example.com')).toBe('DIRECT');
    });

    it('不误匹配相似域名', () => {
      expect(decision(['example.com'], 'notexample.com')).toBe(SERVER_PROXY_STR());
      expect(decision(['example.com'], 'example.com.evil.com')).toBe(SERVER_PROXY_STR());
    });

    it('前置点规则 .google.com 等同 google.com', () => {
      expect(decision(['.google.com'], 'www.google.com')).toBe('DIRECT');
    });

    it('*.local 变体匹配深层子域', () => {
      expect(decision(['*.local'], 'foo.local')).toBe('DIRECT');
      expect(decision(['*.local'], 'deep.a.foo.local')).toBe('DIRECT');
    });
  });

  describe('代理服务器配置输出', () => {
    it('socks5 → SOCKS5', () => {
      const script = generatePacScript(SERVER, []);
      expect(script).toContain('SOCKS5 127.0.0.1:10808');
    });

    it('http/https → PROXY（https 代理必须写作 PROXY，否则 Chrome 拒绝 PAC）', () => {
      expect(generatePacScript({ ...SERVER, scheme: 'http' }, [])).toContain(
        'PROXY 127.0.0.1:10808'
      );
      expect(generatePacScript({ ...SERVER, scheme: 'https' }, [])).toContain(
        'PROXY 127.0.0.1:10808'
      );
    });

    it('非法端口回退 10808', () => {
      expect(generatePacScript({ ...SERVER, port: 99999 }, [])).toContain(':10808');
      expect(generatePacScript({ ...SERVER, port: 0 }, [])).toContain(':10808');
      expect(generatePacScript({ ...SERVER, port: 8080 }, [])).toContain(':8080');
    });

    it('未知 scheme 回退 PROXY', () => {
      const script = generatePacScript({ ...SERVER, scheme: 'ftp' as never }, []);
      expect(script).toContain('PROXY');
    });
  });

  describe('IPv6 方括号规范化', () => {
    it('裸 IPv6 ::1 自动加方括号', () => {
      expect(generatePacScript({ ...SERVER, host: '::1' }, [])).toContain(
        'SOCKS5 [::1]:10808'
      );
    });

    it('已带方括号的 [::2] 不重复添加', () => {
      expect(generatePacScript({ ...SERVER, host: '[::2]' }, [])).toContain(
        'SOCKS5 [::2]:10808'
      );
    });
  });

  describe('注入防护', () => {
    it('host 中的引号/分号/换行被剥离，非法字符回退 127.0.0.1', () => {
      const script = generatePacScript({ ...SERVER, host: 'evil"; PROXY attacker.com' }, []);
      expect(script).toContain('SOCKS5 127.0.0.1:10808');
      expect(script).not.toContain('attacker');
    });

    it('规则中的引号通过 JSON.stringify 安全转义，不破坏脚本', () => {
      const script = generatePacScript(SERVER, ['foo"bar;']);
      // 生成后脚本仍可被 PAC 运行时加载执行
      expect(() => loadPac(script)).not.toThrow();
    });

    it('规则中的非 ASCII 字符被丢弃（Chrome 拒绝非 ASCII PAC）', () => {
      const script = generatePacScript(SERVER, ['localhost', '中文域名.com', '127.0.0.1']);
      const fn = loadPac(script);
      expect(fn('http://localhost', 'localhost')).toBe('DIRECT');
      expect(fn('http://127.0.0.1', '127.0.0.1')).toBe('DIRECT');
      expect(script).not.toContain('中文');
    });
  });

  describe('规则数量与长度上限', () => {
    it(`超过 ${MAX_BYPASS_RULES} 条规则时截断`, () => {
      const rules = Array.from({ length: MAX_BYPASS_RULES + 50 }, (_, i) => `r${i}.example.com`);
      const script = generatePacScript(SERVER, rules);
      // 截断后超出的规则不会出现在脚本中
      expect(script).not.toContain(`r${MAX_BYPASS_RULES}.example.com`);
      // 且运行时只有前 MAX_BYPASS_RULES 条能匹配 DIRECT（decision 返回非空字符串，必须显式比较）
      const matched = rules.filter((r) => decision(rules, r) === 'DIRECT');
      expect(matched.length).toBe(MAX_BYPASS_RULES);
    });

    it(`单条超过 ${MAX_RULE_LENGTH} 字符的规则被丢弃`, () => {
      const longRule = 'a'.repeat(MAX_RULE_LENGTH + 1) + '.example.com';
      const script = generatePacScript(SERVER, ['localhost', longRule]);
      expect(script).not.toContain('a'.repeat(MAX_RULE_LENGTH + 1));
      expect(loadPac(script)('http://localhost', 'localhost')).toBe('DIRECT');
    });

    it('空白规则被忽略', () => {
      const script = generatePacScript(SERVER, ['', '   ', 'localhost']);
      expect(loadPac(script)('http://localhost', 'localhost')).toBe('DIRECT');
    });
  });
});

describe('sanitizeHost', () => {
  it('undefined/空串回退 127.0.0.1', () => {
    expect(sanitizeHost(undefined)).toBe('127.0.0.1');
    expect(sanitizeHost('   ')).toBe('127.0.0.1');
  });

  it('不在白名单字符集（如空格）时回退 127.0.0.1', () => {
    expect(sanitizeHost('evil space')).toBe('127.0.0.1');
    expect(sanitizeHost('evil,comma')).toBe('127.0.0.1');
  });

  it('引号/反斜杠等危险字符被剥离，剩余合法部分保留', () => {
    // 设计行为：HOST_STRIP_PATTERN 剥离危险字符，剩余部分若合法则保留
    expect(sanitizeHost('evil"quote')).toBe('evilquote');
    expect(sanitizeHost('127.0.0.1"')).toBe('127.0.0.1');
  });

  it('超长 host 回退 127.0.0.1', () => {
    expect(sanitizeHost('a'.repeat(300))).toBe('127.0.0.1');
  });

  it('IPv6 裸地址自动加括号，已带括号不变', () => {
    expect(sanitizeHost('::1')).toBe('[::1]');
    expect(sanitizeHost('[fe80::1]')).toBe('[fe80::1]');
  });

  it('普通域名/IP 原样返回', () => {
    expect(sanitizeHost('proxy.example.com')).toBe('proxy.example.com');
    expect(sanitizeHost('192.168.1.1')).toBe('192.168.1.1');
  });
});

function SERVER_PROXY_STR(): string {
  return 'SOCKS5 127.0.0.1:10808';
}
