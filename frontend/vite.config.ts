import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { logsPlugin } from "./dev/logs";
import { researchPlugin } from "./dev/research";
import { snapshotPlugin } from "./dev/snapshot";
export default defineConfig(({ mode }) => ({
  plugins: [react(), logsPlugin(loadEnv(mode, process.cwd(), "VITE_")), researchPlugin(), snapshotPlugin()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
}));
