import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  const dataMode = env.VITE_DATA_MODE || "local";
  if (!["local", "cloudbase", "github"].includes(dataMode))
    throw new Error("VITE_DATA_MODE must be local, cloudbase or github");
  if (dataMode === "cloudbase" && !env.VITE_CLOUDBASE_ENV_ID)
    throw new Error(
      "CloudBase mode requires VITE_CLOUDBASE_ENV_ID. Use local mode until configured.",
    );
  if (dataMode === "github") {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.VITE_GITHUB_REPOSITORY || ""))
      throw new Error("GitHub mode requires VITE_GITHUB_REPOSITORY=owner/repository");
    if (!env.VITE_GITHUB_EDITOR_LOGIN)
      throw new Error("GitHub mode requires VITE_GITHUB_EDITOR_LOGIN");
    if (!env.VITE_GITHUB_DATA_PATH)
      throw new Error("GitHub mode requires VITE_GITHUB_DATA_PATH");
  }
  return {
    base: env.VITE_BASE_PATH || "/",
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            charts: ["recharts"],
            ui: ["react", "react-dom", "@radix-ui/react-dialog"],
          },
        },
      },
    },
    test: { include: ["tests/**/*.test.ts"] },
  };
});
