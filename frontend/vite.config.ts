import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { logsPlugin } from "./dev/logs";
export default defineConfig(({ mode }) => ({
  plugins: [react(), logsPlugin(loadEnv(mode, process.cwd(), "VITE_"))],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
}));
