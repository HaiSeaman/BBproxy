# BBproxy (次世代代理切换扩展)

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
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
- **现代化冰蓝毛玻璃 UI**
  - 高质感浅蓝渐变背景与 `backdrop-filter` 柔和模糊效果。
  - 响应式控制面板，输入框宽裕舒适，防抖自动保存。
- **Manifest V3 极速架构**
  - 完全符合 Chrome 扩展最新 MV3 标准，基于 Service Worker 实现事件驱动型后台管理。
  - 防御性 PAC 脚本生成逻辑，保障即使配置异常也能降级直连，绝不引发网页断网。

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

项目依赖明细：
```json
{
  "dependencies": {
    "vue": "^3.5.13",
    "wxt": "^0.21.3"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.308",
    "@wxt-dev/module-vue": "^1.0.3",
    "typescript": "^5.8.2",
    "vue-tsc": "^2.2.8"
  }
}
```

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
├── assets/               # SVG 图标及主题样式资源
├── entrypoints/          # 扩展入口目录
│   ├── background.ts     # Service Worker 代理控制逻辑
│   └── popup/            # Popup 弹窗 Vue3 界面
│       ├── App.vue       # 主交互面板 UI
│       ├── index.html    # 弹窗 HTML 模板
│       └── main.ts       # Vue3 挂载脚本
├── public/               # 静态资源 (Icon 等)
├── types/                # TypeScript 强类型定义 (proxy.ts)
├── utils/                # 辅助函数库 (pac.ts 脚本生成, storage.ts 存储)
├── .gitignore            # Git 上传过滤配置
├── package.json          # 依赖与脚本指令配置
├── wxt.config.ts         # WXT 框架与 Manifest V3 配置文件
└── README.md             # 项目中文文档
```

---

## 📄 许可证

本项目基于 [MIT License](./LICENSE) 协议开源。
