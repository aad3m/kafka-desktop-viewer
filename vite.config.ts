import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    base: "./",         // ✅ critical for Electron loadFile()
    plugins: [react()],
    server: { port: 5173 }
});