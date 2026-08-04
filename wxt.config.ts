import { defineConfig } from 'wxt'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  extensionApi: 'chrome',
  manifest: {
    name: '简单翻译',
    permissions: ['storage'],
    // Dev debug log sink (scripts/debug-log-server.mjs); unused in production builds
    host_permissions: ['http://127.0.0.1:8787/*'],
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
  vite: () => ({
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, '.'),
        'lib': resolve(__dirname, 'lib'),
        'components': resolve(__dirname, 'components'),
      },
    },
  }),
})
