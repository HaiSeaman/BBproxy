import { defineConfig } from 'wxt';

// 必须用 PNG：Chrome 明确不支持 SVG/WebP 作为扩展图标
// （官方文档："WebP and SVG files are not supported"），用 SVG 会导致工具栏图标不显示。
// 源图见 public/icon.svg，PNG 由它导出。
const ICONS = {
  16: 'icon-16.png',
  32: 'icon-32.png',
  48: 'icon-48.png',
  128: 'icon-128.png',
};

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'BBproxy - 极简代理切换',
    description: '基于 WXT + Vue 3 + TS 开发的极简 Chrome 代理切换插件',
    // version 不在此指定：WXT 自动取 package.json 的 version，保持单一来源
    permissions: ['proxy', 'storage'],
    icons: ICONS,
    action: {
      // 不在此设置 default_title：WXT 会用 popup 的 index.html <title> 覆盖它，
      // 写在这里不会生效。改标题请改 entrypoints/popup/index.html。
      default_popup: 'popup.html',
      default_icon: ICONS,
    },
  },
});
