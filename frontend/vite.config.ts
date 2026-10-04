import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { logsPlugin } from "./dev/logs";
import { researchPlugin } from "./dev/research";
export default defineConfig(({ mode }) => {
  const frontendEnv = loadEnv(mode, process.cwd(), "VITE_");
  const rootEnv = loadEnv(mode, fileURLToPath(new URL("../", import.meta.url)), "NEXT_PUBLIC_CLERK_");
  const clerkPublishableKey = frontendEnv.VITE_CLERK_PUBLISHABLE_KEY || rootEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
  return {
    plugins: [react(), logsPlugin(frontendEnv), researchPlugin()],
    define: { "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(clerkPublishableKey) },
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  };
});
