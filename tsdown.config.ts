import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['source/index.ts'],
  outDir: 'build/js',
  format: 'esm',
  outExtensions: () => ({ js: '.js' }),
})
