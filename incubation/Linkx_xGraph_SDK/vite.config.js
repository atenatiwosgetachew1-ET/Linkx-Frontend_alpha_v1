import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig(({ command }) => {
  // Dev mode: serve the demo app
  if (command === 'serve') {
    return {
      plugins: [react()],
      root: 'demo',
      resolve: {
        alias: {
          '@linkx/graph-preview': resolve(__dirname, 'src/index.js'),
        },
      },
      server: {
        port: 7180,
        host: true,
      },
    };
  }

  // Build mode: library output
  return {
    plugins: [react()],
    build: {
      lib: {
        entry: resolve(__dirname, 'src/index.js'),
        name: 'LinkxGraphPreview',
        formats: ['es', 'umd'],
        fileName: (format) => `linkx-graph-preview.${format === 'es' ? 'es.js' : 'umd.cjs'}`,
      },
      rollupOptions: {
        external: ['react', 'react-dom', 'react/jsx-runtime'],
        output: {
          globals: {
            react: 'React',
            'react-dom': 'ReactDOM',
            'react/jsx-runtime': 'jsxRuntime',
          },
        },
      },
      cssCodeSplit: false,
      sourcemap: true,
    },
  };
});
