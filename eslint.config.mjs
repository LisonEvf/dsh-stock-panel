// eslint.config.mjs —— B4 质量网：ESLint（flat config）
//
// 设计取舍（为什么不做"全量 recommended"）：
//   这个仓库有 28 个旧页面（`src/pages/*`、`src/components/*`）仍是窄列时代的写法，
//   一次性套上全部 recommended 会得到上千条噪音，然后被"整片 disable"掉 —— 那等于没 lint。
//   所以这里只启用**能抓真 bug**的规则集，先让门禁立起来、再逐步加码：
//     · react-hooks：rules-of-hooks（error）+ exhaustive-deps（warn）
//       —— 本会话已在 `src/lib/cache.ts` 抓过同类真 bug（deps 缺项导致 refreshInterval 改动永不生效）；
//     · TS：未使用变量（warn，且允许 `_` 前缀）、未使用表达式、`any` 提示（warn，不阻断）；
//     · 基础：no-empty（允许空 catch，代码里大量 `catch { /* ignore */ }` 是刻意的）、
//       no-constant-condition 等低噪音规则。
//   规则一律"宁少勿滥"：warning 全部清零后，`--max-warnings 0` 已收紧为硬门禁
//   （棘轮只降不升：30 → 0，见 package.json 与 .github/workflows/ci.yml）。
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // ⚠️ 全局忽略必须是**只含 `ignores` 的对象**：把 ignores 与其它键写在同一个对象里，
  // 它就退化成"该对象内的文件过滤"，文件仍会被后续配置命中 —— 实测踩过
  // （vendor 的 opentdx.js 因此被 lint，它自带的 @typescript-eslint disable 注释
  // 在未定义该规则的配置下直接报 error）。
  {
    ignores: [
      'lib/**',
      'node_modules/**',
      'docs/**',
      'gateway/**',
      'src/host/vendor/**', // node-tdx 构建产物（vendor，不参与 lint）
      '.unit-build/**',
      'concept-*.json',
      '*.log',
    ],
  },
  {
    // 失效的 `eslint-disable` 必须被发现（B4 的明确要求：不允许"注释写了但规则没生效"）。
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        Uint8Array: 'readonly',
        URL: 'readonly',
        HTMLElement: 'readonly',
        EventTarget: 'readonly',
        CustomEvent: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        React: 'readonly', // JSX 走经典转换（React.createElement）
      },
    },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooks },
    rules: {
      // ★ 真 bug 猎手
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // TS：未使用（`_` 前缀视为刻意忽略）
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-unused-private-class-members': 'warn',
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-self-assign': 'error',
      'no-cond-assign': 'error',
      // 空语句块：允许（`catch { /* ignore */ }` 是本仓库的既定写法）
      'no-empty': 'off',
    },
  },
  {
    // 脚本与测试：Node 环境 + 宽松（大量 ad-hoc 断言）
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-undef': 'off',
    },
  },
)
