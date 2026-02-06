import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // デフォルトはrendererテスト用のjsdom環境
    environment: 'jsdom',
    setupFiles: ['./src/renderer/test/setup.ts'],
    include: [
      'src/renderer/**/*.test.{ts,tsx}',
      'src/main/**/*.test.ts'
    ],
    // main processのテストはnode環境で実行
    environmentMatchGlobs: [
      ['src/main/**/*.test.ts', 'node']
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/renderer/**/*.{ts,tsx}',
        'src/main/**/*.ts'
      ],
      exclude: [
        'src/renderer/test/**',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts'
      ]
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer')
    }
  }
})
