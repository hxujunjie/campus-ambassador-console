import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace } from "../src/domain";
import {
  clearGitHubCredential,
  connectGitHubEditor,
  loadGitHubWorkspace,
  currentGitHubEditor,
  remembersGitHubDevice,
  saveGitHubWorkspace,
} from "../src/github-storage";

const settings = {
  repository: "hxujunjie/campus-console",
  branch: "main",
  path: "data/workspace.json",
  editorLogin: "hxujunjie",
};
const session = new Map<string, string>();
const device = new Map<string, string>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const encode = (body: unknown) =>
  btoa(unescape(encodeURIComponent(JSON.stringify(body))));

beforeEach(() => {
  vi.stubEnv("VITE_DATA_MODE", "local");
  session.clear();
  device.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => device.get(key) ?? null,
    setItem: (key: string, value: string) => device.set(key, value),
    removeItem: (key: string) => device.delete(key),
  });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => session.get(key) ?? null,
    setItem: (key: string, value: string) => session.set(key, value),
    removeItem: (key: string) => session.delete(key),
  });
  vi.restoreAllMocks();
  clearGitHubCredential();
});

describe("GitHub 公共数据与授权写入", () => {
  it("匿名读取公开快照，不需要令牌", async () => {
    const snapshot = { workspace: seedWorkspace(), revision: 7 };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(snapshot), { status: 200 }),
        ),
    );
    const loaded = await loadGitHubWorkspace(settings);
    expect(loaded.revision).toBe(7);
    expect(loaded.workspace.rows).toHaveLength(8);
  });

  it("只接受配置的 GitHub 编辑账号，并将令牌保存在当前会话", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ login: "someone-else" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      connectGitHubEditor("github_pat_test", settings),
    ).rejects.toThrow("请使用 GitHub 账号 hxujunjie 的令牌");
    expect(session.size).toBe(0);
  });

  it("验证所有者、仓库写入权限和数据文件后才连接", async () => {
    const snapshot = { workspace: seedWorkspace(), revision: 0 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ login: "hxujunjie" }))
      .mockResolvedValueOnce(json({ permissions: { push: true } }))
      .mockResolvedValueOnce(
        json({ content: encode(snapshot), encoding: "base64" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      connectGitHubEditor("github_pat_test", settings),
    ).resolves.toBe("hxujunjie");
    expect(session.size).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("保存前核对公开快照版本，并用文件 SHA 条件更新", async () => {
    const current = { workspace: seedWorkspace(), revision: 3 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({ sha: "blob-v3", encoding: "base64", content: encode(current) }),
      )
      .mockResolvedValueOnce(json({ commit: { sha: "commit-v4" } }))
      .mockResolvedValueOnce(
        json({
          encoding: "base64",
          content: encode({ ...current, revision: 4 }),
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    session.set("campus-console:github-edit-token:v1", "github_pat_test");

    const next = await saveGitHubWorkspace(current.workspace, 3, settings);
    expect(next.revision).toBe(4);
    expect(next.receipt?.verified).toBe(true);
    expect(next.receipt?.commitUrl).toContain("commit-v4");
    expect(fetchMock.mock.calls[2][0]).toContain("ref=commit-v4");
    const put = fetchMock.mock.calls[1];
    expect(put[1]?.method).toBe("PUT");
    expect(JSON.parse(String(put[1]?.body)).sha).toBe("blob-v3");
    expect(JSON.parse(String(put[1]?.body)).content).toBeTruthy();
  });

  it("成功提交后回读失败保留提交回执，避免误报为写入失败", async () => {
    session.set("campus-console:github-edit-token:v1", "github_pat_test");
    const current = { workspace: seedWorkspace(), revision: 3 };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          json({
            sha: "blob-v3",
            encoding: "base64",
            content: encode(current),
          }),
        )
        .mockResolvedValueOnce(json({ commit: { sha: "commit-v4" } }))
        .mockRejectedValueOnce(new Error("network")),
    );
    const saved = await saveGitHubWorkspace(current.workspace, 3, settings);
    expect(saved.revision).toBe(4);
    expect(saved.receipt).toMatchObject({
      verified: false,
      commitUrl: expect.stringContaining("commit-v4"),
    });
  });

  it("写入响应中断后先回读，识别已经成功的同一版本", async () => {
    session.set("campus-console:github-edit-token:v1", "github_pat_test");
    const current = { workspace: seedWorkspace(), revision: 3 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({ sha: "blob-v3", encoding: "base64", content: encode(current) }),
      )
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce(
        json({
          encoding: "base64",
          content: encode({ ...current, revision: 4 }),
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const saved = await saveGitHubWorkspace(current.workspace, 3, settings);
    expect(saved.receipt?.verified).toBe(true);
    expect(
      fetchMock.mock.calls.filter((call) => call[1]?.method === "PUT"),
    ).toHaveLength(1);
  });

  it("网络或临时拒绝保留设备授权，确定失效时清除", async () => {
    device.set("campus-console:github-edit-token:v1", "github_pat_test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("network")));
    expect(await currentGitHubEditor(settings)).toBeNull();
    expect(remembersGitHubDevice()).toBe(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({}, 403)));
    expect(await currentGitHubEditor(settings)).toBeNull();
    expect(remembersGitHubDevice()).toBe(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({}, 401)));
    expect(await currentGitHubEditor(settings)).toBeNull();
    expect(remembersGitHubDevice()).toBe(false);
  });

  it("发现另一设备已更新时拒绝写入", async () => {
    session.set("campus-console:github-edit-token:v1", "github_pat_test");
    const fetchMock = vi.fn().mockResolvedValue(
      json({
        sha: "blob-v4",
        encoding: "base64",
        content: encode({ workspace: seedWorkspace(), revision: 4 }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      saveGitHubWorkspace(seedWorkspace(), 3, settings),
    ).rejects.toThrow("GitHub 数据已在其他设备更新");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
