// In-memory browser and SDK doubles verify conflict handling, not actual CloudBase permissions.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace } from "../src/domain";
let repository: typeof import("../src/repository");
const data = new Map<string, string>();
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("VITE_DATA_MODE", "local");
  data.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_key: string, callback: () => unknown) => callback(),
    },
  });
  repository = await import("../src/repository");
});
describe("本地持久化与冲突保护", () => {
  it("刷新读取保留新增记录", async () => {
    const initial = await repository.loadWorkspace();
    initial.workspace.rows[0].notes = "真实补充";
    await repository.saveWorkspace(initial.workspace, initial.revision);
    const next = await repository.loadWorkspace();
    expect(next.workspace.rows[0].notes).toBe("真实补充");
    expect(next.revision).toBe(1);
  });
  it("旧窗口提交被拒绝，不能覆盖较新版本", async () => {
    const first = await repository.loadWorkspace();
    await repository.saveWorkspace(first.workspace, first.revision);
    await expect(
      repository.saveWorkspace(first.workspace, first.revision),
    ).rejects.toBeInstanceOf(repository.ConflictError);
    expect((await repository.loadWorkspace()).revision).toBe(1);
  });
  it("损坏数据不被自动清空或替换成种子", async () => {
    data.set(repository.LOCAL_KEY, "{bad");
    await expect(repository.loadWorkspace()).rejects.toThrow();
    expect(data.get(repository.LOCAL_KEY)).toBe("{bad");
  });
  it("存储空间不足时保留原内容并反馈错误", async () => {
    const initial = await repository.loadWorkspace();
    const raw = data.get(repository.LOCAL_KEY);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    await expect(
      repository.saveWorkspace(seedWorkspace(), initial.revision),
    ).rejects.toThrow("QuotaExceededError");
    expect(data.get(repository.LOCAL_KEY)).toBe(raw);
  });
});
