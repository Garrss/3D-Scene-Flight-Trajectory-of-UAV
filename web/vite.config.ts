import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_DEV_API_TARGET || 'http://127.0.0.1:8080'

  return {
    plugins: [react(), cesium()],
    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          // vite-plugin-cesium already externalizes Cesium out of the
          // bundle; keep the remaining heavy engine (Three.js) in its own
          // chunk so route-level lazy() avoids downloading it until the
          // digital-twin workspace opens.
          manualChunks: {
            three: ['three'],
          },
        },
      },
    },
    server: {
      host: '127.0.0.1', // Mengikat langsung ke IPv4 loopback
      port: 5173,
      proxy: {
        '/ws': {
          target: apiTarget,
          ws: true,
        },
        '/api': {
          target: apiTarget,
        },
        '/healthz': {
          target: apiTarget,
        },
      },
    },
  }
})
