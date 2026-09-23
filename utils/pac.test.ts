import { describe, expect, it } from 'vitest';
import {
  generateBypassList,
  generatePacScript,
  isUsableProxyHost,
  parseRulesText,
  sanitizeHost,
} from './pac';
import { MAX_BYPASS_RULES, MAX_HOST_LENGTH, MAX_RULE_LENGTH } from '../types/proxy';
import { dnsDomainIs, loadPacScript as loadPac } from './testing/pacRuntime';

const SERVER = { host: '127.0.0.1', port: 10808, scheme: 'socks5' as const };
const PROXY_STR = 'SOCKS5 127.0.0.1:10808';

function decision(rules: string[], host: string): string {
  return loadPac(generatePacScript(SERVER, rules))('http://' + host, host);
}

describe('Chromium PAC 内置函数的真实语义（夹具对现实的刻画）', () => {
  it('dnsDomainIs 是纯字符串后缀匹配，不看点边界', () => {
    // 该行为取自 Chromium services/proxy_resolver/pac_js_library.h。
    // 这正是"不能拿它做域名白名单"的原因：它会把 notexample.com 判给 example.com。
    expect(dnsDomainIs('notexample.com', 'example.com')).toBe(true);
    expect(dnsDomainIs('mygithub.com', 'github.com')).toBe(true);
    // 只有带前导点才具备边界语义，且此时反而匹配不到裸域本身。
    expect(dnsDomainIs('www.mozilla.org', '.mozilla.org')).toBe(true);
    expect(dnsDomainIs('mozilla.org', '.mozilla.org')).toBe(false);
  });
});

describe('白名单域名边界（回归：曾用 dnsDomainIs 导致同尾域名被误直连）', () => {
  it('规则 example.com 只匹配自身与子域，不吞同尾域名', () => {
    expect(decision(['example.com'], 'example.com')).toBe('DIRECT');
    expect(decision(['example.com'], 'www.example.com')).toBe('DIRECT');
    expect(decision(['example.com'], 'a.b.example.com')).toBe('DIRECT');
    expect(decision(['example.com'], 'notexample.com')).toBe(PROXY_STR);
    expect(decision(['example.com'], 'evil-example.com')).toBe(PROXY_STR);
  });

  it('规则 github.com 不吞 mygithub.com', () => {
    expect(decision(['github.com'], 'github.com')).toBe('DIRECT');
    expect(decision(['github.com'], 'api.github.com')).toBe('DIRECT');
    expect(decision(['github.com'], 'mygithub.com')).toBe(PROXY_STR);
  });

  it('前置点规则 .google.com 语义等同于 google.com', () => {
    expect(decision(['.google.com'], 'google.com')).toBe('DIRECT');
    expect(decision(['.google.com'], 'www.google.com')).toBe('DIRECT');
    expect(decision(['.google.com'], 'notgoogle.com')).toBe(PROXY_STR);
  });

  it('带尾点的主机（FQDN 写法）仍能命中白名单', () => {
    // Chrome 对 http://example.com./ 传给 PAC 的 host 就是 "example.com."，
    // 若不做尾点归一，局域网/白名单主机写成 FQDN 形式时会漏掉而被迫走代理
    expect(decision(['example.com'], 'example.com.')).toBe('DIRECT');
    expect(decision(['example.com'], 'www.example.com.')).toBe('DIRECT');
    expect(decision(['192.168.*'], '192.168.1.1.')).toBe('DIRECT');
  });
});

describe('规则大小写不敏感（回归：曾因 host 小写而规则大写导致永不匹配）', () => {
  it('大写规则仍能匹配小写 host', () => {
    expect(decision(['Example.COM'], 'www.example.com')).toBe('DIRECT');
    expect(decision(['EXAMPLE.com'], 'example.com')).toBe('DIRECT');
  });

  it('大写 host 仍能匹配小写规则', () => {
    expect(decision(['example.com'], 'WWW.Example.COM')).toBe('DIRECT');
  });
});

describe('规则不得与对象原型链撞名', () => {
  it('没有任何规则时，名为 constructor 的主机必须走代理', () => {
    // host 经 toLowerCase 后仍全小写的 Object.prototype 成员只有 constructor 与 __proto__，
    // 故只有这两个名字会撞上原型链。若哈希表用普通对象字面量 {}，
    // exactSet['constructor'] 会命中继承来的 Object.prototype.constructor（真值），
    // 使该主机被误判直连。改用 Object.create(null) 后无原型可继承。
    // 该断言用空规则集，专门隔离"撞原型"这一个原因，是能抓住该变异的最小用例。
    expect(decision([], 'constructor')).toBe(PROXY_STR);
    expect(decision([], '__proto__')).toBe(PROXY_STR);
  });

  it('规则 constructor 只匹配它自己', () => {
    expect(decision(['constructor'], 'constructor')).toBe('DIRECT');
    expect(decision(['constructor'], 'www.example.com')).toBe(PROXY_STR);
    expect(decision(['constructor'], 'notconstructor')).toBe(PROXY_STR);
  });
});

describe('generatePacScript', () => {
  describe('通配符规则（回归测试：曾因预分类漏判 ? 而失效）', () => {
    it('? 单字符通配符应匹配 DIRECT', () => {
      expect(decision(['10.0.0.?'], '10.0.0.1')).toBe('DIRECT');
      expect(decision(['10.0.0.?'], '10.0.0.a')).toBe('DIRECT');
      expect(decision(['a?c.example.com'], 'abc.example.com')).toBe('DIRECT');
    });

    it('? 通配符不应匹配多位或多于一位', () => {
      expect(decision(['10.0.0.?'], '10.0.0.12')).toBe(PROXY_STR);
      expect(decision(['10.0.0.?'], '10.0.0.')).toBe(PROXY_STR);
    });

    it('* 通配符匹配任意字符', () => {
      expect(decision(['192.168.*'], '192.168.1.5')).toBe('DIRECT');
      expect(decision(['192.168.*'], '10.0.0.1')).toBe(PROXY_STR);
    });

    it('通配规则中的点号被转义，不会当成"任意字符"', () => {
      // 若生成 RegExp 时没有转义 '.'，'*.corp.net' 会变成 '.*corp.net'，
      // 从而把 evilcorp.net 也误判为直连
      expect(decision(['*.corp.net'], 'a.corp.net')).toBe('DIRECT');
      expect(decision(['*.corp.net'], 'evilcorp.net')).toBe(PROXY_STR);
      expect(decision(['*.corp.net'], 'evilcorpxnet')).toBe(PROXY_STR);
    });

    it('通配规则中的正则元字符被转义，不会破坏匹配或逃逸', () => {
      expect(decision(['*.a+b.com'], 'x.a+b.com')).toBe('DIRECT');
      expect(decision(['*.a+b.com'], 'x.aab.com')).toBe(PROXY_STR);
      expect(decision(['*.a(b.com'], 'x.a(b.com')).toBe('DIRECT');
    });
  });

  describe('精确域名 / 子域匹配', () => {
    it('规则域名匹配自身与子域', () => {
      expect(decision(['example.com'], 'example.com')).toBe('DIRECT');
      expect(decision(['example.com'], 'www.example.com')).toBe('DIRECT');
      expect(decision(['example.com'], 'deep.a.example.com')).toBe('DIRECT');
    });

    it('不误匹配相似域名', () => {
      expect(decision(['example.com'], 'notexample.com')).toBe(PROXY_STR);
      expect(decision(['example.com'], 'example.com.evil.com')).toBe(PROXY_STR);
    });

    it('*.local 变体匹配深层子域', () => {
      expect(decision(['*.local'], 'foo.local')).toBe('DIRECT');
      expect(decision(['*.local'], 'deep.a.foo.local')).toBe('DIRECT');
    });
  });

  describe('代理服务器配置输出', () => {
    it('socks5 → SOCKS5', () => {
      const fn = loadPac(generatePacScript(SERVER, []));
      expect(fn('http://example.com', 'example.com')).toBe('SOCKS5 127.0.0.1:10808');
    });

    it('http → PROXY', () => {
      const fn = loadPac(generatePacScript({ ...SERVER, scheme: 'http' }, []));
      expect(fn('http://example.com', 'example.com')).toBe('PROXY 127.0.0.1:10808');
    });

    it('https → HTTPS（不能降级为明文 PROXY）', () => {
      // Chromium net/docs/proxy.md 的 PAC 标识符列表包含 HTTPS。
      // 若把 https 代理写成 PROXY，Chrome 会用明文 HTTP 去连一个 TLS 端口，
      // 代理直接不可用（旧代码正是这样，且注释声称"否则 Chrome 拒绝该 PAC"，该说法有误）。
      const fn = loadPac(generatePacScript({ ...SERVER, scheme: 'https' }, []));
      expect(fn('http://example.com', 'example.com')).toBe('HTTPS 127.0.0.1:10808');
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

    it('生成的脚本整体必须是纯 ASCII（Chrome 会整体拒绝非 ASCII 的 pacScript.data）', () => {
      // 模板里混进一个中文注释就会让整个 PAC 被 Chrome 拒收，代理彻底不生效。
      // 这里用真实数据喂最坏情况，钉住"模板本身不得出现非 ASCII"这条约束。
      const script = generatePacScript(
        { ...SERVER, host: '中文代理.com' },
        ['localhost', '中文域名.com', '192.168.*', '*.企业.local'],
        true
      );
      expect(script).toMatch(/^[\x00-\x7F]*$/);
    });
  });

  describe('规则数量与长度上限', () => {
    it(`超过 ${MAX_BYPASS_RULES} 条规则时按顺序截断：边界内直连、边界外走代理`, () => {
      const rules = Array.from({ length: MAX_BYPASS_RULES + 50 }, (_, i) => `r${i}.example.com`);
      // 直接断言边界两侧各一条的判定结果：比"统计命中总数"更能定位截断位置错在哪
      expect(decision(rules, `r${MAX_BYPASS_RULES - 1}.example.com`)).toBe('DIRECT');
      expect(decision(rules, `r${MAX_BYPASS_RULES}.example.com`)).toBe(PROXY_STR);
      expect(decision(rules, `r${MAX_BYPASS_RULES + 49}.example.com`)).toBe(PROXY_STR);
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

describe('generateBypassList（Global 模式的 bypassList 翻译）', () => {
  it('普通规则补一条 *. 前缀，使子域也被直连（与 PAC 语义对齐）', () => {
    // 官方文档规定 bypassList 中 "foobar.com" 不匹配子域，而 PAC 中该规则匹配子域。
    // 不补 *. 前缀的话，同一份白名单在 Global / Auto 两个模式下分流结果不一致。
    expect(generateBypassList(['example.com'])).toEqual(['example.com', '*.example.com']);
  });

  it('前置点被剥离，并按普通规则处理', () => {
    expect(generateBypassList(['.google.com'])).toEqual(['google.com', '*.google.com']);
  });

  it('规则统一小写', () => {
    expect(generateBypassList(['Example.COM'])).toEqual(['example.com', '*.example.com']);
  });

  it('通配规则原样透传，不补无意义的 *. 变体', () => {
    // '*.192.168.*' 这类变体永远匹配不到任何 host，只会让判定列表白白翻倍
    expect(generateBypassList(['192.168.*'])).toEqual(['192.168.*']);
  });

  it('? 通配放宽为 *（bypassList 不支持单字符通配）', () => {
    expect(generateBypassList(['10.0.0.?'])).toEqual(['10.0.0.*']);
  });

  it('非 ASCII / 空白 / 超长规则被丢弃，条数受限', () => {
    const longRule = 'a'.repeat(MAX_RULE_LENGTH + 1);
    expect(generateBypassList(['ok.com', '', '   ', '中文.com', longRule])).toEqual([
      'ok.com',
      '*.ok.com',
    ]);

    const many = Array.from({ length: MAX_BYPASS_RULES + 10 }, (_, i) => `r${i}.com`);
    const list = generateBypassList(many);
    // 断言边界两侧：比断言"总条数 = 上限×2"更能定位截断位置错在哪
    expect(list).toContain(`r${MAX_BYPASS_RULES - 1}.com`);
    expect(list).not.toContain(`r${MAX_BYPASS_RULES}.com`);
  });
});

describe('故障转移开关（fallbackDirect）', () => {
  it('默认关闭：代理串不带 DIRECT 兜底', () => {
    const fn = loadPac(generatePacScript(SERVER, []));
    expect(fn('http://example.com', 'example.com')).toBe(PROXY_STR);
  });

  it('开启后：命中白名单仍直连，未命中的返回 代理;DIRECT 兜底链', () => {
    const fn = loadPac(generatePacScript(SERVER, ['example.com'], true));
    expect(fn('http://example.com', 'example.com')).toBe('DIRECT');
    expect(fn('http://other.com', 'other.com')).toBe(`${PROXY_STR}; DIRECT`);
  });
});

describe('isUsableProxyHost（用户可用的代理主机名判定）', () => {
  it('域名 / IPv4 / IPv6（裸写或带括号）都算可用', () => {
    expect(isUsableProxyHost('proxy.example.com')).toBe(true);
    expect(isUsableProxyHost('127.0.0.1')).toBe(true);
    expect(isUsableProxyHost('::1')).toBe(true);
    expect(isUsableProxyHost('[::1]')).toBe(true);
    expect(isUsableProxyHost('  127.0.0.1  ')).toBe(true);
  });

  it('会被清洗改写的输入一律判为不可用，避免静默把用户配置改成别的主机', () => {
    expect(isUsableProxyHost('my proxy')).toBe(false); // 空格
    expect(isUsableProxyHost('evil"quote')).toBe(false); // 引号会被剥离
    expect(isUsableProxyHost('')).toBe(false);
    expect(isUsableProxyHost('   ')).toBe(false);
    expect(isUsableProxyHost(undefined)).toBe(false);
    expect(isUsableProxyHost('a'.repeat(MAX_HOST_LENGTH + 1))).toBe(false);
  });
});

describe('parseRulesText（面板文本域 → 规则数组）', () => {
  it('按行拆分、去首尾空白、丢空行并去重', () => {
    expect(parseRulesText('localhost\n\n  127.0.0.1  \nlocalhost\n')).toEqual([
      'localhost',
      '127.0.0.1',
    ]);
  });

  it('空文本或纯空白得到空数组', () => {
    expect(parseRulesText('')).toEqual([]);
    expect(parseRulesText('\n  \n')).toEqual([]);
  });
});

