import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  build: {
    sourcemap: mode === "development",
    rollupOptions: {
      output: {
        chunkFileNames: 'v/[hash].js',
        entryFileNames: 'v/[hash].js',
        assetFileNames: 'v/[hash].[ext]'
      }
    }
  },
  server: {
    host: "::",
    port: 8080,
    allowedHosts: [
      "roadsightai.roadvision.ai",
      "roadvision.ai",
      "localhost",
      "127.0.0.1"
    ],
  },
  plugins: [
    react(), mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
