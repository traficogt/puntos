import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/revision-astryx/9b72f5a1/',
  publicDir: false,
  build: {outDir: '../../public/revision-astryx/9b72f5a1', emptyOutDir: true, sourcemap: false},
});
