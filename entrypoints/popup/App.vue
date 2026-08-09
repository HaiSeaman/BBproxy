<template>
  <div class="bbproxy-container">
    <!-- 头部品牌 Header -->
    <header class="header">
      <div class="brand">
        <div class="logo-box">
          <svg class="logo-svg" viewBox="0 0 128 128" width="22" height="22">
            <circle cx="64" cy="64" r="42" fill="none" stroke="currentColor" stroke-width="8" stroke-dasharray="180 80" />
            <circle cx="46" cy="64" r="10" fill="currentColor" />
            <circle cx="82" cy="64" r="10" fill="currentColor" />
          </svg>
        </div>
        <div class="brand-text">
          <span class="title">BBproxy</span>
          <span class="subtitle">Next-Gen Proxy</span>
        </div>
      </div>
      <div class="status-badge" :class="config.currentMode">
        <span class="dot"></span>
        <span class="status-text">{{ modeLabel(config.currentMode) }}</span>
      </div>
    </header>

    <!-- 模式切换 Mode Selector Cards -->
    <section class="mode-selector">
      <button
        class="mode-card"
        :class="{ active: config.currentMode === 'direct' }"
        @click="switchMode('direct')"
      >
        <div class="icon-wrapper direct-icon">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14M13 5l7 7-7 7"/>
          </svg>
        </div>
        <div class="card-info">
          <span class="card-title">Direct</span>
          <span class="card-desc">直连模式 (绕过代理)</span>
        </div>
      </button>

      <button
        class="mode-card"
        :class="{ active: config.currentMode === 'global' }"
        @click="switchMode('global')"
      >
        <div class="icon-wrapper global-icon">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </div>
        <div class="card-info">
          <span class="card-title">Global</span>
          <span class="card-desc">全局代理 (全部转发)</span>
        </div>
      </button>

      <button
        class="mode-card"
        :class="{ active: config.currentMode === 'auto' }"
        @click="switchMode('auto')"
      >
        <div class="icon-wrapper auto-icon">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 3 21 3 21 8"/>
            <line x1="4" y1="20" x2="21" y2="3"/>
            <polyline points="21 16 21 21 16 21"/>
            <line x1="15" y1="15" x2="21" y2="21"/>
            <line x1="4" y1="4" x2="9" y2="9"/>
          </svg>
        </div>
        <div class="card-info">
          <span class="card-title">Auto Bypass</span>
          <span class="card-desc">白名单分流 (智能切流)</span>
        </div>
      </button>
    </section>

    <!-- 代理服务器设置 Server Config Card -->
    <section class="config-section">
      <div class="section-header">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
          <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
          <line x1="6" y1="6" x2="6.01" y2="6"></line>
          <line x1="6" y1="18" x2="6.01" y2="18"></line>
        </svg>
        <span>代理服务器设置</span>
      </div>

      <div class="form-grid">
        <div class="field-group scheme-group">
          <label class="field-label">协议</label>
          <select v-model="config.server.scheme" class="custom-select" @change="saveConfig">
            <option value="socks5">SOCKS5</option>
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
          </select>
        </div>

        <div class="field-group host-group">
          <label class="field-label">服务器地址</label>
          <input
            type="text"
            v-model="config.server.host"
            class="custom-input"
            placeholder="127.0.0.1"
            @input="debouncedSave"
          />
        </div>

        <div class="field-group port-group">
          <label class="field-label">端口</label>
          <input
            type="number"
            v-model.number="config.server.port"
            class="custom-input"
            placeholder="10808"
            min="1"
            max="65535"
            @input="debouncedSave"
          />
        </div>
      </div>
    </section>

    <!-- 直连白名单 Rules Section (仅在 Auto 模式或点击折叠时显示) -->
    <section class="rules-section" v-if="config.currentMode === 'auto'">
      <div class="section-header">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        <span>直连白名单规则 (DIRECT)</span>
      </div>
      <p class="section-tip">匹配列表的 IP/网段直接直连，其余流量走代理：</p>
      <textarea
        v-model="rawBypassRules"
        class="custom-textarea"
        rows="4"
        placeholder="每行一个 IP、局域网段或域名规则，例如：&#10;127.0.0.1&#10;192.168.*&#10;localhost"
        @input="debouncedSaveRules"
      ></textarea>
    </section>

    <!-- 底部状态 Footer -->
    <footer class="footer">
      <div class="save-status">
        <span v-if="saving" class="saving-text">保存中...</span>
        <span v-else-if="savedToast" class="saved-text">✓ 已自动保存</span>
        <span v-else class="version-text">BBproxy v1.0.0</span>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import type { ProxyMode, ProxyScheme, ProxyStorageConfig } from '../../types/proxy';
import { DEFAULT_PROXY_CONFIG } from '../../types/proxy';
import { getProxyConfig, saveProxyConfig } from '../../utils/storage';

const config = reactive<ProxyStorageConfig>({
  currentMode: 'direct',
  server: {
    host: '127.0.0.1',
    port: 10808,
    scheme: 'socks5',
  },
  bypassRules: [],
});

const rawBypassRules = ref('');
const saving = ref(false);
const savedToast = ref(false);

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

onMounted(async () => {
  try {
    const saved = await getProxyConfig();
    config.currentMode = saved.currentMode || DEFAULT_PROXY_CONFIG.currentMode;
    config.server.host = saved.server?.host || DEFAULT_PROXY_CONFIG.server.host;
    config.server.port = saved.server?.port || DEFAULT_PROXY_CONFIG.server.port;
    config.server.scheme = (saved.server?.scheme as ProxyScheme) || DEFAULT_PROXY_CONFIG.server.scheme;
    config.bypassRules = Array.isArray(saved.bypassRules) ? saved.bypassRules : [...DEFAULT_PROXY_CONFIG.bypassRules];
    rawBypassRules.value = config.bypassRules.join('\n');
  } catch (err) {
    console.error('[BBproxy] 读取配置失败，使用默认配置:', err);
  }
});

function modeLabel(mode: ProxyMode): string {
  switch (mode) {
    case 'direct':
      return '直连模式';
    case 'global':
      return '全局代理';
    case 'auto':
      return '白名单分流';
  }
}

async function switchMode(mode: ProxyMode) {
  // 先取消排队的防抖保存，避免旧输入触发重复保存覆盖新模式
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  config.currentMode = mode;
  await saveConfig();
}

async function saveConfig() {
  // 端口前端规整：非法输入立即回退默认值，避免依赖后台静默修正
  const port = Number(config.server.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    config.server.port = DEFAULT_PROXY_CONFIG.server.port;
  }

  saving.value = true;
  try {
    // 深拷贝后再写入，避免 Vue reactive Proxy 参与序列化
    await saveProxyConfig(JSON.parse(JSON.stringify(config)));
  } catch (err) {
    console.error('[BBproxy] 配置保存失败:', err);
  } finally {
    saving.value = false;
  }
  showToast();
}

function debouncedSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveConfig();
  }, 400);
}

function debouncedSaveRules() {
  const parsed = rawBypassRules.value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  config.bypassRules = Array.from(new Set(parsed));

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveConfig();
  }, 600);
}

function showToast() {
  savedToast.value = true;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    savedToast.value = false;
  }, 1500);
}
</script>

<style scoped>
/* 浅色清新 + 毛玻璃 (Frosted Glass / Ice Blue Light Theme) System */
.bbproxy-container {
  width: 360px;
  background: linear-gradient(135deg, #E0F2FE 0%, #F0F9FF 50%, #F8FAFC 100%);
  color: #0F172A;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  padding: 16px;
  box-sizing: border-box;
  user-select: none;
  border-radius: 12px;
}

/* Header 顶部品牌区 */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo-box {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(135deg, #0284C7 0%, #0369A1 100%);
  border: 1px solid rgba(255, 255, 255, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #FFFFFF;
  box-shadow: 0 4px 12px rgba(2, 132, 199, 0.25);
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.brand-text .title {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -0.2px;
  color: #0F172A;
}

.brand-text .subtitle {
  font-size: 9px;
  color: #0284C7;
  font-weight: 600;
  letter-spacing: 0.8px;
  text-transform: uppercase;
}

/* 状态 Badge */
.status-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 2px 8px rgba(148, 163, 184, 0.12);
  font-size: 11px;
  font-weight: 600;
}

.status-badge .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.status-badge.direct {
  border-color: rgba(148, 163, 184, 0.4);
  color: #475569;
}
.status-badge.direct .dot {
  background: #64748B;
}

.status-badge.global {
  border-color: rgba(99, 102, 241, 0.4);
  color: #4F46E5;
}
.status-badge.global .dot {
  background: #4F46E5;
  box-shadow: 0 0 6px rgba(79, 70, 229, 0.4);
}

.status-badge.auto {
  border-color: rgba(2, 132, 199, 0.4);
  color: #0284C7;
}
.status-badge.auto .dot {
  background: #0284C7;
  box-shadow: 0 0 6px rgba(2, 132, 199, 0.4);
}

/* 模式选择 Card Selector */
.mode-selector {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}

.mode-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.8);
  color: #334155;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  text-align: left;
  box-shadow: 0 2px 6px rgba(148, 163, 184, 0.08);
}

.mode-card:hover {
  background: rgba(255, 255, 255, 0.9);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(148, 163, 184, 0.15);
}

.mode-card.active {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(240, 249, 255, 0.95) 100%);
  border-color: #0284C7;
  color: #0F172A;
  box-shadow: 0 4px 14px rgba(2, 132, 199, 0.15), 0 0 0 1px #0284C7;
}

.icon-wrapper {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(241, 245, 249, 0.8);
  color: #64748B;
}

.mode-card.active .direct-icon {
  background: #E2E8F0;
  color: #334155;
}

.mode-card.active .global-icon {
  background: #EEF2FF;
  color: #4F46E5;
}

.mode-card.active .auto-icon {
  background: #E0F2FE;
  color: #0284C7;
}

.card-info {
  display: flex;
  flex-direction: column;
}

.card-title {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
}

.card-desc {
  font-size: 11px;
  color: #64748B;
  margin-top: 2px;
}

/* Config Section */
.config-section,
.rules-section {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.9);
  padding: 14px;
  margin-bottom: 14px;
  box-shadow: 0 4px 16px rgba(148, 163, 184, 0.1);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: #334155;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* 核心修复：提升卡片宽度 (360px)，重新定义 Grid 布局比例 95px 1fr 90px */
.form-grid {
  display: grid;
  grid-template-columns: 95px 1fr 90px;
  gap: 10px;
  align-items: start;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0; /* 允许 flex / grid 子元素自适应截断不溢出 */
}

.field-label {
  font-size: 11px;
  font-weight: 600;
  color: #64748B;
}

.custom-select,
.custom-input,
.custom-textarea {
  width: 100%;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid #CBD5E1;
  border-radius: 8px;
  color: #0F172A;
  font-size: 12px;
  font-weight: 500;
  padding: 7px 10px;
  outline: none;
  transition: all 0.2s ease;
  box-sizing: border-box;
}

.custom-select:focus,
.custom-input:focus,
.custom-textarea:focus {
  border-color: #0284C7;
  background: #FFFFFF;
  box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.15);
}

.custom-textarea {
  resize: vertical;
  font-family: SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
  line-height: 1.4;
}

.section-tip {
  font-size: 11px;
  color: #64748B;
  margin: -4px 0 10px 0;
}

/* Footer */
.footer {
  display: flex;
  justify-content: flex-end;
  font-size: 11px;
  color: #64748B;
  padding-top: 2px;
}

.saving-text {
  color: #0284C7;
  font-weight: 600;
}
.saved-text {
  color: #059669;
  font-weight: 600;
}
.version-text {
  color: #94A3B8;
}
</style>
