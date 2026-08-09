import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'BBproxy - 极简代理切换',
    description: '基于 WXT + Vue 3 + TS 开发的极简 Chrome 代理切换插件',
    version: '1.0.0',
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
