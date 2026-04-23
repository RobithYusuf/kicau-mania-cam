import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          "face-api": ["@vladmandic/face-api"],
          "mediapipe": ["@mediapipe/tasks-vision"],
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
