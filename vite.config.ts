import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          "face-api": ["@vladmandic/face-api"],
          "mediapipe": ["@mediapipe/hands"],
          "supabase": ["@supabase/supabase-js"],
        },
      },
    },
  },
  server: {
    port: 8080,
    host: true,
  },
  preview: {
    port: 8080,
  },
});
