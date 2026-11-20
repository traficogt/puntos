import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Hashed asset filenames change every build; without clearing the output
// directory the old ones pile up (git-tracked) and ship in every image. Wipe
// the assets dir at the start of each build so only the current hashes remain.
// Scoped to recursos/ so sibling files (index.html, notices) are untouched.
const recursos = fileURLToPath(new URL("../../public/merchant/recursos", import.meta.url));

export default defineConfig({
  base: "/negocio/",
  plugins: [
    react(),
    { name: "pf-clean-recursos", buildStart() { rmSync(recursos, { recursive: true, force: true }); } },
  ],
  publicDir: false,
  build: {
    outDir: "../../public/merchant",
    emptyOutDir: false,
    assetsDir: "recursos",
    rollupOptions: { external: ["/lib.js"] },
  },
});
