import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createServer } from "vite";

const output = resolve("data/workspace.json");
try {
  await access(output);
  throw new Error("data/workspace.json already exists; refusing to replace it.");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { seedWorkspace } = await server.ssrLoadModule("/src/domain.ts");
  const snapshot = { workspace: seedWorkspace(), revision: 0 };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(snapshot) + "\n", "utf8");
} finally {
  await server.close();
}
console.log(`Created ${output} with the verified V1 initial records.`);
