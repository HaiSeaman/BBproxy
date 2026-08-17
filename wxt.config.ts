import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'BBproxy - 极简代理切换',
    description: '基于 WXT + Vue 3 + TS 开发的极简 Chrome 代理切换插件',
    // version 不在此指定：WXT 自动取 package.json 的 version，保持单一来源
    permissions: ['proxy', 'storage'],
    icons: {
      128: 'icon.svg',
    },
    action: {
      default_title: 'BBproxy - 极简代理切换',
      default_popup: 'popup.html',
      default_icon: {
        128: 'icon.svg',
      },
    },
  },
});
