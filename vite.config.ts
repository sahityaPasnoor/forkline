import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const devPort = Number.parseInt(process.env.VITE_PORT || '5555', 10)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // crucial for electron
  server: {
    host: '127.0.0.1',
    port: Number.isFinite(devPort) ? devPort : 5555,
    strictPort: true,
    cors: false
  },
  preview: {
    host: '127.0.0.1',
    cors: false
  }
})
