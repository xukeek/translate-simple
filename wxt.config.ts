import { defineConfig } from 'wxt'

export default defineConfig({
  extensionApi: 'chrome',
  manifest: {
    name: '沉浸式翻译 - 简易版',
    permissions: ['storage'],
    action: {
      default_popup: 'entrypoints/popup/index.html',
    },
    commands: {
      toggleTranslate: {
        suggested_key: { default: 'Alt+T' },
        description: '切换翻译',
      },
    },
  },
})
