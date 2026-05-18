import { defineConfig, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [
    {
      name: 'load-js-as-jsx',
      async transform(code, id) {
        if (!id.endsWith('.js')) return null;
        return transformWithEsbuild(code, id, {
          loader: 'jsx',
          jsx: 'automatic'
        });
      }
    },
    react()
  ],
  optimizeDeps: {
    esbuildOptions: {
      loader: { '.js': 'jsx' }
    }
  }
});