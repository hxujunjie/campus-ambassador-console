import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace } from "../src/domain";
const mock = vi.hoisted(() => ({
  uid: "test-owner",
  doc: null as null | Record<string, unknown>,
  query: {} as Record<string, unknown>,
  updated: 1,
  failAdd: false,
}));
vi.mock("@cloudbase/js-sdk", () => ({
  default: {
    init: () => ({
      auth: () => ({
        getLoginState: async () =>
          mock.uid ? { user: { uid: mock.uid } } : null,
        signOut: async () => {},
        signInWithEmailAndPassword: async () => {},
      }),
      database: () => ({
        collection: () => ({
          where: (query: Record<string, unknown>) => {
            mock.query = query;
            return {
              get: async () => ({ data: mock.doc ? [mock.doc] : [] }),
              update: async (data: Record<string, unknown>) => {
                if (mock.updated === 1) mock.doc = { ...mock.doc, ...data };
                return { updated: mock.updated };
              },
            };
          },
          add: async (doc: Record<string, unknown>) => {
            if (mock.failAdd) throw new Error("permission denied");
            mock.doc = doc;
          },
        }),
      }),
    }),
  },
}));
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_DATA_MODE", "cloudbase");
  vi.stubEnv("VITE_CLOUDBASE_ENV_ID", "test-environment");
  mock.uid = "test-owner";
  mock.doc = null;
  mock.query = {};
  mock.updated = 1;
  mock.failAdd = false;
});
describe("CloudBase 适配器契约（模拟 SDK，不代替真实环境验收）", () => {
  it("需要认证，拒绝匿名读取", async () => {
    mock.uid = "";
    const repo = await import("../src/repository");
    await expect(repo.loadWorkspace()).rejects.toThrow("请先登录");
  });
  it("首次为当前用户创建独立文档", async () => {
    const repo = await import("../src/repository");
    const value = await repo.loadWorkspace();
    expect(value.workspace.rows).toHaveLength(8);
    expect(mock.doc?._openid).toBe("test-owner");
    expect(mock.doc?._id).toBe("test-owner");
    expect(mock.query).toEqual({ _id: "test-owner", _openid: "test-owner" });
  });
  it("已有云端记录不会重新写种子", async () => {
    const workspace = seedWorkspace();
    workspace.rows[0].notes = "云端已有内容";
    mock.doc = { payload: JSON.stringify(workspace), revision: 6 };
    const repo = await import("../src/repository");
    const value = await repo.loadWorkspace();
    expect(value.revision).toBe(6);
    expect(value.workspace.rows[0].notes).toBe("云端已有内容");
  });
  it("保存限定所有者和版本，冲突不覆盖", async () => {
    const repo = await import("../src/repository");
    const value = await repo.loadWorkspace();
    const saved = await repo.saveWorkspace(value.workspace, 0);
    expect(saved.revision).toBe(1);
    expect(mock.query).toEqual({
      _id: "test-owner",
      _openid: "test-owner",
      revision: 0,
    });
    mock.updated = 0;
    await expect(repo.saveWorkspace(value.workspace, 0)).rejects.toBeInstanceOf(
      repo.ConflictError,
    );
  });
  it("创建权限失败可见，不降级到本地伪装成功", async () => {
    mock.failAdd = true;
    const repo = await import("../src/repository");
    await expect(repo.loadWorkspace()).rejects.toThrow("云端初始化失败");
  });
});
