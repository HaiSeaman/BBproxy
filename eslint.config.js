import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // ignores 必须是独立的全局配置块
  { ignores: ['node_modules', '.output', '.wxt', 'tmp'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 防御式清洗代码中显式使用 any 接收未知外部数据，属有意为之
      '@typescript-eslint/no-explicit-any': 'off',
      // /^[\x00-\x7F]*$/ 是检查"仅含 ASCII"的标准写法，属有意使用
      'no-control-regex': 'off',
    },
  }
);
