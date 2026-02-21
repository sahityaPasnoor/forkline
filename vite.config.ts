import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // crucial for electron
  server: {
    port: 5177,
    strictPort: true
  }
})
