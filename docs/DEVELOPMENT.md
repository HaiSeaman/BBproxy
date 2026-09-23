# BBproxy 开发者文档

面向**要改这个项目代码的人**。使用者请看 [README.md](../README.md)。

---

## 1. 这个扩展到底做了什么（运行链路）

BBproxy 是一个 Chrome Manifest V3 扩展，只干两件事：

1. 把 Chrome 的流量**指向本地的代理客户端**（如 `127.0.0.1:10808`）；
2. 让**白名单里的目标直连**（主要用途是局域网 IP，避免局域网流量绕一圈代理）。

> 重要边界：**本扩展不做流量分流规划**。哪个域名走哪条线路，由上游代理客户端决定。
> 扩展里的白名单只是"这些目标别走代理"，不是一套路由引擎。

完整链路：

```
用户点开面板 → main.ts 先读 storage → 挂载 Vue 面板
                                            │ 用户改配置
                                            ▼
                            saveProxyConfig() 写入 chrome.storage.local
                                            │
                          chrome.storage.onChanged 触发
                                            ▼
background.ts: sanitizeProxyConfig → enqueueApply（串行队列，只保留最新）
                                            ▼
                       applyProxySettings → chrome.proxy.settings.set
                                            │
                    ┌───────────────────────┴───────────────────────┐
                    ▼                                               ▼
          Global: fixed_servers + bypassList              Auto: pac_script（内联 PAC）
                    └───────────────────────┬───────────────────────┘
                                            ▼
                        Chrome 对每个网络请求执行一次判定
                        （Auto 模式执行我们生成的 FindProxyForURL）
```

**每个网络请求只经过一次扩展的代码**：Auto 模式下 `FindProxyForURL` 的一次字符串判定。扩展**没有注册任何 `webRequest` 拦截器**，不改包、不阻断，所以对浏览速度的结构性影响为零。

---

## 2. 目录与文件职责

```
entrypoints/
  background.ts        Service Worker：读配置 → 清洗 → 串行队列 → 写入 chrome.proxy
  popup/
    main.ts            先读配置，再挂载面板（不这么做会有覆盖用户配置的竞态）
    App.vue            面板 UI 与唯一写入路径
    index.html         面板模板；其 <title> 同时是工具栏悬停提示（WXT 用它填 manifest）
utils/
  pac.ts               规则清洗、分类、PAC 脚本生成、bypassList 翻译、主机名校验
  storage.ts           配置读写、脏数据清洗、面板读取入口、写前展开
  testing/
    pacRuntime.ts      测试夹具：复刻 Chromium 真实 PAC 内置函数
  *.test.ts            单元测试
types/proxy.ts         类型定义与限制常量（含默认配置）
public/
  icon.svg             图标源图（不参与打包引用）
  icon-{16,32,48,128}.png  manifest 实际引用的图标
wxt.config.ts          WXT 与 manifest 配置
```

---

## 3. 关键设计决策（以及为什么这样做）

### 3.1 为什么把普通规则放进哈希表、通配规则预编译成正则

PAC 跑在浏览器网络栈的**热路径**上，对每个请求**同步执行**。Chromium 的事实：

- PAC 的 V8 沙箱以 `--jitless` 运行（无 JIT，也无正则 JIT）；
- 内置的 `shExpMatch` 每次调用都要做 3 次 `replace` + 一次 `new RegExp()`；
- `FindProxyForURL` 在单一 helper 线程上执行，并发请求会排队。

所以任何"每条规则调一次内置函数"的写法都是每请求税。现在的做法是
**生成时预分类、装载时预编译**：普通规则进哈希表做 O(1) 查询，通配规则各编译一次正则复用。
实测（`node --jitless`，2000 主机 / 200 条规则）：`257µs/次` → `15µs/次`，约 17 倍；
且耗时随规则条数几乎不变（30 条与 1 条相差不足 0.1µs）。

### 3.2 为什么不用 PAC 内置的 `dnsDomainIs` 做域名匹配

Chromium 的实现（`services/proxy_resolver/pac_js_library.h`）是**纯字符串后缀比较**：

```js
host.length >= domain.length && host.substring(host.length - domain.length) == domain
```

它**不看点号边界**，于是 `dnsDomainIs("notexample.com", "example.com")` 返回 `true`。
拿它做白名单会让 `notexample.com`、`mygithub.com` 这类"同尾域名"被错误直连
（本该走代理）。现在改为手写点边界判断 + 逐级去掉最左标签向上查找父域名，
既正确，又只要 O(域名层数) 次哈希查询。

### 3.3 为什么哈希表用 `Object.create(null)`

`host` 经 `toLowerCase()` 后仍全小写的 `Object.prototype` 成员只有 `constructor` 与 `__proto__`。
若用普通对象字面量，规则恰好叫这两个名字之一时，`exactSet["constructor"]` 会命中继承来的
成员（真值），使名为该名字的主机被误判直连。`Object.create(null)` 无原型可继承，彻底消除该情形。
（这条有专门的测试，且做过变异检查确认测试真能失败。）

### 3.4 为什么生成的 PAC 必须保持纯 ASCII

Chrome 会**整体拒绝**含非 ASCII 字符的 `pacScript.data`。
模板里混进一个中文注释就会让整个 PAC 失效、代理彻底不工作。
因此 `pac.ts` 的模板字符串内**只能写英文注释**，并有测试钉住这条约束。

### 3.5 为什么面板要"先读配置再挂载"

旧实现是：面板先用默认值渲染，再异步读 storage 回填。
用户在这段空窗里点一下模式卡片，就会把**默认的** 127.0.0.1 / 端口 / 白名单整份写回，
覆盖掉用户自己的真实配置，而界面还显示"已保存"。
现在 `main.ts` 先 `await loadPopupState()` 再 `createApp(...).mount()`，竞态窗口不存在了，
`userInteracted` 那套补丁也一并删除。

### 3.6 为什么只有一条写入路径

面板里所有触发点（输入防抖、切模式、协议下拉、复选框）都走 `saveConfig`。
因为**共用防抖定时器会互相取消**：敲完白名单 600ms 内动一下主机，规则那个定时器被取消，
`config.bypassRules` 从未更新，整批新规则静默丢失。
现在的 `saveConfig` 每次执行前都先 `parseRulesText(rawBypassRules.value)`，
于是**无论谁触发、无论谁被取消，都不可能漏数据**。

### 3.7 为什么主机名校验只有一个口径

旧实现里 `sanitizeProxyConfig` 只检查长度，`sanitizeHost` 才检查字符集，
于是 `my proxy` 被存进 storage，应用时才被静默改成 `127.0.0.1`
——面板显示 A、实际用 B，毫无提示。现在两处共用 `isUsableProxyHost`：
面板直接拒绝非法输入并给出文案，storage 入口也会把非法值回退为默认。

### 3.8 为什么图标必须是 PNG

Chrome 官方明确："WebP and SVG files are not supported"。
用 SVG 会导致工具栏图标不显示。`public/icon.svg` 是设计源图，
`icon-{16,32,48,128}.png` 才是 manifest 真正引用的文件；改图标请改 SVG 后重新导出 PNG。

### 3.9 为什么故障转移开关默认关闭

PAC 返回 `PROXY host:port; DIRECT` 可以在代理不可达时自动退回直连，避免整机断网。
但代价是**故障期间流量会绕过代理**（隐私暴露面）。因此默认关闭，由用户在 Auto 模式显式开启，
界面上也写明了这个代价。Global 模式（`fixed_servers`）没有兜底链概念，故该开关只在 Auto 模式显示。

---

## 4. 两种模式的白名单语义（务必对齐）

| 能力 | Global（`fixed_servers`） | Auto（`pac_script`） |
|---|---|---|
| 普通规则 `example.com` | 翻译为 `example.com` + `*.example.com`（自身 + 子域） | 哈希表精确匹配 + 父域名逐级查找（自身 + 子域） |
| 通配规则 `192.168.*` | 原样交给 Chrome 的 `bypassList` | 转成正则 `^192\.168\..*$` |
| 单字符通配 `?` | bypassList 不支持，放宽为 `*` | 原生支持（`?` → `.`） |
| CIDR `192.168.0.0/16` | Chrome 原生支持 | **不支持**，请改用 `192.168.*` |
| 带尾点主机 `example.com.` | 由 Chrome 处理 | PAC 内自行归一化尾点 |

**为什么 Global 要补 `*.` 前缀**：官方文档规定 `bypassList` 中 `"foobar.com"` 只匹配
`foobar.com` **本身、不匹配子域**，而 PAC 中该规则匹配子域。不翻译的话，
同一份白名单在两个模式下的分流结果会不一致，用户切模式时会看到行为悄悄变化。

---

## 5. 开发与验证

```powershell
npm install
npm run dev       # WXT 开发模式（热重载）
npm run compile   # 类型检查
npm run lint      # ESLint
npm test          # 单元测试（vitest）
npm run build     # 构建到 .output/chrome-mv3
```

**提交前必须全绿**：`compile` + `lint` + `test` + `build` 四项都不能有报错或警告。

### 测试策略（两条硬规矩）

1. **夹具必须忠于现实。** `utils/testing/pacRuntime.ts` 里复刻的 Chromium 内置函数
   **必须逐字取自 Chromium 源码**。曾有一版把 `dnsDomainIs` 手写成比 Chrome 更严格的版本，
   结果一个真机 bug 在测试里永远是绿的。**夹具背离现实 = 测试变成安慰剂。**
2. **新写的测试要验证它真能失败。** 对关键逻辑做变异检查：故意把实现改坏，
   确认测试会红。例如把 `Object.create(null)` 改成 `{}`，必须有测试失败，否则那条测试是摆设。

### 调试 PAC

PAC 是内联在配置里的字符串，可直接取出执行来验证判定结果：

```powershell
node --jitless -e "
const s = require('fs').readFileSync('pac-dump.js','utf8');
const f = new Function(s + '\nreturn FindProxyForURL;')();
console.log(f('http://192.168.1.1', '192.168.1.1'));  // 期望 DIRECT
"
```

`--jitless` 是为了贴近 Chrome 的 PAC 沙箱（无 JIT），性能数字才有意义。

---

## 6. 发布流程

1. 改 `package.json` 的 `version`（**只改这一处**，WXT 会自动同步进 manifest）。
2. 把本次改动写进 `CHANGELOG.md`。
3. 跑第 5 节的全套验证。
4. `npm run zip` → 产出 `.output/bbproxy-<版本>-chrome.zip`。
5. 上传 zip 到 Chrome 应用商店，或直接把 zip 发给使用者
   （对方解压后在 `chrome://extensions/` 开启开发者模式 →「加载已解压的扩展程序」选文件夹）。

> **不要**把扩展打包成 `.exe`。Chrome 只认商店安装、解压文件夹、`.crx` 三种方式，
> `.exe` 无法安装扩展，还会触发杀毒软件与浏览器的安全拦截。

---

## 7. 已知限制与有意不做的部分

- **Auto 模式不支持 CIDR 写法**（见第 4 节）。统一它需要给 PAC 加一套 IPv4 网段解析，
  当前使用者的用法（`192.168.*`）用不到，故未实现，改为在 README 里写明差异。
- **面板与 Service Worker 的改动没有 DOM 级自动化测试**。项目未安装 jsdom / @vue/test-utils，
  面板层靠类型检查、构建与逻辑推演验证；可抽出的纯逻辑（`parseRulesText`、
  `isUsableProxyHost`、`loadPopupState`）都已抽出并覆盖。
- **面板若 storage 读取永不返回，会一直空白**（旧实现至少会用默认值渲染）。
  实际不会发生，故未加超时兜底；如果要更保守，可给 `loadPopupState` 加 `Promise.race` 超时。
- **成功应用代理后仍会无条件 `remove(PROXY_ERROR_KEY)`**，即使本来没有错误记录。
  加"是否有错误"的标志会引入跨上下文状态同步问题（面板自己也能清错误），
  为不到 1ms 的开销给正确性埋雷不划算，故保持现状。
- **每条 `storage.onChanged` 都会唤醒 Service Worker**。这是 MV3 的固有模型，不是缺陷。

---

## 8. 变更记录：1.3.0

### 逻辑与正确性修复

| 问题 | 根因 | 修法 |
|---|---|---|
| 同尾域名被错误直连（`notexample.com` 命中规则 `example.com`） | 用了 Chromium 的 `dnsDomainIs`，它是无点边界的纯后缀比较 | 改为手写点边界判断 + 父域名逐级查找 |
| 大写规则永不匹配（`Example.COM` 形同虚设） | 规则未归一化，而 host 是小写 | 生成时与运行时统一小写 |
| 规则名为 `constructor` 时该主机被误判直连 | 哈希表用普通对象字面量，会命中 `Object.prototype` 成员 | 改用 `Object.create(null)` |
| 通配规则额外生成的 `*.` 变体永远匹配不到 | 该变体对 IP 类规则无意义 | 删除，通配规则列表减半 |
| 带尾点的 FQDN 主机命中不了白名单 | 未做尾点归一 | PAC 内剥掉单个尾点 |
| HTTPS 代理被当明文 HTTP 代理连接（代理直接不可用） | 映射表把 `https` 写成 `PROXY`，且注释声称"否则 Chrome 拒绝该 PAC"（该说法有误） | 改为 PAC 的 `HTTPS` 标识符，并修正注释 |
| 面板显示的主机与实际使用的主机不一致 | `sanitizeProxyConfig` 只查长度，`sanitizeHost` 才查字符集 | 统一为 `isUsableProxyHost`，面板直接拒绝非法输入并提示 |
| 面板覆盖用户真实配置（数据丢失） | 先用默认值渲染、异步回填；空窗内操作会把默认值写回 | 改为先读完再挂载，删除 `userInteracted` 补丁 |
| 刚输入的白名单规则整批丢失 | 主机/端口与规则**共用同一个防抖定时器**，会互相取消 | 单一写入路径，每次保存前先解析文本域 |
| 代理应用超时被当作成功（静默失败） | 超时分支只 `resolve()`，不报错 | 超时写入错误提示 |
| `settings.set` 失败只打 console | 未上报 `chrome.runtime.lastError` | 写入错误提示 |
| `onProxyError` 丢掉致命错误、成功后有新错误被限流吞掉 | 限流未区分致命错误，且成功后未复位窗口 | 致命错误绕过限流并标注；成功应用时复位限流窗口 |

### 性能

- PAC 热路径重写：哈希表 + 预编译正则，实测 200 条规则 `257µs → 15µs`（约 17 倍），
  且耗时随规则条数几乎不变。
- 面板打开时的两次串行 storage 读取合并为一次 IPC（`loadPopupState`）。

### 新增功能

- 代理故障转移开关（`fallbackDirect`，默认关闭，仅 Auto 模式，界面写明隐私代价）。
- Global 模式的 `bypassList` 语义对齐（`generateBypassList`），两种模式行为一致。
- 面板底部状态区分"地址不合法，未保存"与"保存失败，请重试"。

### 资源与构建

- 图标由 SVG 改为 PNG（16/32/48/128）——Chrome 不支持 SVG 图标。
- 修正 `wxt.config.ts` 里不生效的 `default_title`：WXT 用 `popup/index.html` 的 `<title>` 覆盖它，
  已删除该死配置并改对真正的源头。

### 测试

- 测试夹具换成 Chromium **真身**实现（原 mock 比 Chrome 宽松/严格都会让测试失去意义）。
- 用例由 36 增至 67；对关键逻辑做变异检查，确认测试真会失败。
- 清理空洞断言（改为能定位边界的断言）、无谓函数别名与从未使用的死函数。

### 文档

- README：版本徽章、项目结构、白名单语义与 CIDR 差异、常用脚本表；
  修正"绝不引发网页断网"的不实承诺（故障转移默认关闭）。
- 新增本文件与 `CHANGELOG.md`。
- 删除无人引用的空目录 `assets/`。
