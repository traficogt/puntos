import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "/negocio/",
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: "../../public/merchant",
    emptyOutDir: false,
    assetsDir: "recursos",
    rollupOptions: { external: ["/lib.js"] },
  },
});
