# BBproxy (次世代代理切换扩展)

![Version](https://img.shields.io/badge/version-1.3.0-blue.svg)
![Manifest](https://img.shields.io/badge/Manifest-V3-green.svg)
![Vue](https://img.shields.io/badge/Vue-3.5-brightgreen.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

BBproxy 是一款基于 **WXT 框架 + Vue 3 + TypeScript** 开发的现代极简 Chrome 代理切换扩展。它拥有极快的响应速度、通透好看的**冰蓝浅色毛玻璃 UI 界面**，支持 Direct 直连、Global 全局代理和 Auto 白名单自动分流三种代理模式。

---

## ✨ 核心特性

- **三种灵活模式切换**
  - **Direct (直连)**: 禁用所有代理，直接连接网络。
  - **Global (全局代理)**: 所有网络请求统一通过指定的代理服务器转发。
  - **Auto (自动分流/白名单模式)**: 基于 Chrome PAC 脚本，白名单内的局域网段/IP/域名强行直连，其余流量自动走代理。
- **白名单语义在两种模式下保持一致**
  - 域名规则始终匹配「域名自身 + 其所有子域」：写 `example.com` 会同时覆盖 `www.example.com`，
    但**不会**误伤 `notexample.com` 这类同尾域名；带尾点的 FQDN 写法（`example.com.`）同样能命中。
  - Global 模式会把规则翻译为等价的 `bypassList` 条目，因此切换模式不会让分流行为悄悄改变。
  - 唯一的语法差异：`IP/前缀长度` 这种 CIDR 写法（如 `192.168.0.0/16`）只有 Global 模式原生支持；
    Auto 模式请使用 `192.168.*` 或 `192.168.1.?` 这类通配写法。
- **可选的代理故障转移**
  - Auto 模式下可开启「代理不可达时退回直连」，避免代理挂掉时整机断网。
  - 默认关闭：开启后代理故障期间的流量会绕过代理，请自行权衡。
- **现代化冰蓝毛玻璃 UI**
  - 高质感浅蓝渐变背景与 `backdrop-filter` 柔和模糊效果。
  - 响应式控制面板，输入框宽裕舒适，防抖自动保存。
- **Manifest V3 极速架构**
  - 完全符合 Chrome 扩展最新 MV3 标准，基于 Service Worker 实现事件驱动型后台管理。
  - 所有配置入口都先清洗再使用：非法主机/端口会被替换为安全的默认值，不会生成语法非法的 PAC。
    注意：代理服务器不可达时**默认不会**自动退回直连（这会让流量绕过代理），
    需要的话请在 Auto 模式显式开启「代理不可达时退回直连」。

---

## 🛠️ 项目技术栈

- **扩展框架**: [WXT Framework](https://wxt.dev/) (v0.21)
- **UI 框架**: [Vue 3](https://vuejs.org/) (`<script setup lang="ts">`)
- **构建工具**: [Vite 8](https://vitejs.dev/)
- **类型系统**: [TypeScript 5.8](https://www.typescriptlang.org/)
- **核心 API**: `chrome.proxy`, `chrome.storage.local`

---

## 📦 依赖环境

在开始使用或开发之前，请确保您的计算机上已安装：

- **Node.js**: `>= 18.0.0` (推荐 Node.js 20 LTS 或更高版本)
- **包管理器**: `npm` / `pnpm` / `yarn`

项目依赖明细以 `package.json` 为准（此处不再重复罗列，避免两份清单不同步）。

常用脚本：

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动 WXT 开发模式（热重载） |
| `npm run build` | 编译打包到 `.output/chrome-mv3` |
| `npm run zip` | 生成可上传商店的 zip 包 |
| `npm run compile` | TypeScript 类型检查 |
| `npm run lint` | ESLint 代码检查 |
| `npm test` | 运行单元测试（vitest） |

---

## 🚀 快速开始

### 1. 克隆项目与安装依赖

```bash
# 克隆仓库
git clone https://github.com/your-username/BBproxy.git
cd BBproxy

# 安装依赖
npm install
```

### 2. 编译打包

运行以下构建命令生成适用于 Chrome 的扩展打包产物：

```bash
npm run build
```

构建成功后，将在根目录下生成产物文件夹：
`.output/chrome-mv3`

### 3. 在 Chrome 中载入使用

1. 打开 Chrome 浏览器，访问扩展管理页面：`chrome://extensions/`
2. 打开右上角的 **“开发者模式” (Developer mode)** 开关。
3. 点击 **“加载已解压的扩展程序” (Load unpacked)** 按钮。
4. 选择本项目根目录下的 **`.output/chrome-mv3`** 文件夹。
5. 点击浏览器工具栏的 **BBproxy** 图标，即可开启现代化极简代理切换体验！

---

## 📂 项目结构说明

```
BBproxy/
├── .output/              # WXT 编译构建产物目录 (已被 .gitignore 忽略)
├── docs/
│   └── DEVELOPMENT.md    # 开发者文档：架构、设计决策与原因、开发与发布流程
├── entrypoints/          # 扩展入口目录
│   ├── background.ts     # Service Worker 代理控制逻辑
│   └── popup/            # Popup 弹窗 Vue3 界面
│       ├── App.vue       # 主交互面板 UI
│       ├── index.html    # 弹窗 HTML 模板（其 <title> 即工具栏悬停提示）
│       └── main.ts       # 先读配置再挂载面板
├── public/               # 静态资源：icon.svg 为图标源图，icon-{16,32,48,128}.png 为实际打包的图标
├── types/                # TypeScript 强类型定义 (proxy.ts)
├── utils/                # 辅助函数库
│   ├── pac.ts            # PAC 脚本 / bypassList 生成与规则清洗
│   ├── storage.ts        # 配置读写与脏数据清洗
│   └── testing/          # 测试夹具（复刻 Chromium 真实 PAC 运行时）
├── CHANGELOG.md          # 版本变更记录
├── eslint.config.js      # ESLint 配置
├── package.json          # 依赖与脚本指令配置
├── wxt.config.ts         # WXT 框架与 Manifest V3 配置文件
└── README.md             # 项目中文文档
```

> 图标为什么有 SVG 又有 PNG：`icon.svg` 是设计源图，但 Chrome **不支持** SVG 作为扩展图标
> （官方文档明确 "WebP and SVG files are not supported"），因此 manifest 实际引用的是导出后的
> PNG。修改图标请改 SVG 后重新导出 PNG。

---

## 📄 许可证

本项目基于 [MIT License](./LICENSE) 协议开源。
