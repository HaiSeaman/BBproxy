import { createApp } from 'vue';
import App from './App.vue';
import { DEFAULT_PROXY_CONFIG } from '../../types/proxy';
import { loadPopupState, toPlainConfig } from '../../utils/storage';

/**
 * 先读完配置再挂载面板，而不是挂载后再异步回填。
 *
 * 原因：面板若用默认值先渲染、等 storage 读回来再覆盖，用户在这段空窗里点模式卡片
 * 或改输入框，就会把"默认值"当成真实配置整份写回 storage，
 * 把用户自己的主机/端口/白名单覆盖掉（数据丢失级竞态），而界面还会显示"已保存"。
 * 读取失败时退回默认配置，保证面板至少可用。
 */
async function mountPopup() {
  let state;
  try {
    state = await loadPopupState();
  } catch (err) {
    console.error('[BBproxy] 读取配置失败，使用默认配置:', err);
    state = { config: toPlainConfig(DEFAULT_PROXY_CONFIG), error: '' };
  }

  createApp(App, {
    initialConfig: state.config,
    initialError: state.error,
  }).mount('#app');
}

void mountPopup();
