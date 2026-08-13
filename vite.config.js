import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages（プロジェクトサイト）でも動くよう相対パスでビルド
export default defineConfig({
  plugins: [react()],
  base: "./",
});
