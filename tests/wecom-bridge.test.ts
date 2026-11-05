import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { seedWorkspace, workspaceSchema } from "../src/domain";
const script = resolve("scripts/wecom-sync.mjs");
function tempDir() {
  mkdirSync("work", { recursive: true });
  return mkdtempSync(resolve("work/cli-test-"));
}
function fixtureEnv(extra: Record<string, string> = {}) {
  return {
    ...process.env,
    WECOM_CLI_ENTRY: resolve("tests/fixtures/wecom-cli.mjs"),
    ...extra,
  };
}
function run(args: string[], env = fixtureEnv()) {
  return execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, ...args],
    { env, encoding: "utf8", windowsHide: true },
  );
}
function writeConfig(path: string, chatId = "fixture-internal-group") {
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      branch: "main",
      groups: [
        {
          chatId,
          label: "社群 A",
          key: "a".repeat(32),
        },
      ],
    }),
  );
}

describe("企业微信 CLI 汇总同步（离线模拟）", () => {
  it("候选导出只含群级消息条数，不保存正文、人员或群内部标识", () => {
    const dir = tempDir();
    const out = resolve(dir, "candidates.json");
    try {
      run([
        "pull",
        "--group",
        "验收测试群",
        "--days",
        "7",
        "--out",
        out,
      ], fixtureEnv({ WECOM_PSEUDONYM_KEY_PATH: resolve(dir, "private-key") }));
      const first = JSON.parse(readFileSync(out, "utf8"));
      const raw = readFileSync(out, "utf8");
      expect(first.rows).toHaveLength(2);
      expect(first.rows[0].count).toBeNull();
      expect(first.rows[0].countMode).toBe("unknown");
      expect(first.rows[1].count).toBe(2);
      expect(first.rows[1].category).toBe("近 7 天群消息数");
      expect(raw).not.toContain("fixture-internal-group");
      expect(raw).not.toContain("fixture-internal-person");
      expect(raw).not.toContain("测试人员");
      expect(raw).not.toContain("第一条摘录");
      expect(raw).not.toContain("验收测试群");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("自动合并只刷新企业微信群级汇总，并保留已核实的成员数与原始成果", () => {
    const dir = tempDir();
    const config = resolve(dir, "config.json");
    const data = resolve(dir, "workspace.json");
    try {
      writeConfig(config);
      writeFileSync(data, JSON.stringify({ workspace: seedWorkspace(), revision: 4 }));
      run(
        ["sync", "--config", config, "--data", data],
        fixtureEnv({ QA_MESSAGE_COUNT: "2" }),
      );

      const first = JSON.parse(readFileSync(data, "utf8"));
      expect(first.revision).toBe(5);
      const community = first.workspace.rows.find(
        (row: any) => row.kind === "communities" && row.source === "企业微信 CLI",
      );
      const observation = first.workspace.rows.find(
        (row: any) => row.kind === "interactions" && row.source === "企业微信 CLI",
      );
      expect(community.title).toBe("社群 A");
      expect(community.count).toBeNull();
      expect(community.countMode).toBe("unknown");
      expect(observation.count).toBe(2);
      expect(observation.status).toBe("已确认");
      expect(observation.groupId).toBe(community.id);
      expect(first.workspace.rows.find((row: any) => row.id === "seed-competition").count).toBe(5);

      community.count = 5;
      community.countMode = "exact";
      community.status = "已确认";
      community.notes = "用户已经核对了成员总数。";
      writeFileSync(data, JSON.stringify(first));
      run(
        ["sync", "--config", config, "--data", data],
        fixtureEnv({ QA_MESSAGE_COUNT: "3" }),
      );

      const second = JSON.parse(readFileSync(data, "utf8"));
      expect(second.revision).toBe(6);
      const refreshedCommunity = second.workspace.rows.find(
        (row: any) => row.id === community.id,
      );
      const refreshedObservation = second.workspace.rows.find(
        (row: any) => row.id === observation.id,
      );
      expect(refreshedCommunity.count).toBe(5);
      expect(refreshedCommunity.status).toBe("已确认");
      expect(refreshedCommunity.notes).toBe("用户已经核对了成员总数。");
      expect(refreshedObservation.count).toBe(3);
      const raw = readFileSync(data, "utf8");
      expect(raw).not.toContain("fixture-internal-group");
      expect(raw).not.toContain("验收测试群");
      expect(raw).not.toContain("fixture-internal-person");
      expect(raw).not.toContain("第一条摘录");
      expect(workspaceSchema.safeParse(second.workspace).success).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dry-run 不写入文件", () => {
    const dir = tempDir();
    const config = resolve(dir, "config.json");
    const data = resolve(dir, "workspace.json");
    const original = JSON.stringify({ workspace: seedWorkspace(), revision: 0 });
    try {
      writeConfig(config);
      writeFileSync(data, original);
      run(["sync", "--config", config, "--data", data, "--dry-run"]);
      expect(readFileSync(data, "utf8")).toBe(original);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("授权群列表分页异常时停止，不打印任何内部标识", () => {
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", script, "pull", "--group", "验收测试群"],
      {
        env: fixtureEnv({ QA_BAD_CURSOR: "1" }),
        encoding: "utf8",
        windowsHide: true,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("分页游标异常");
    expect(result.stderr).not.toContain("fixture-internal-group");
    expect(result.stderr).not.toContain("fixture-internal-person");
  });

  it("只显示企业微信错误代码，不透出接口错误中的标识或网络信息", () => {
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", script, "list"],
      {
        env: fixtureEnv({ QA_API_ERROR: "1" }),
        encoding: "utf8",
        windowsHide: true,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("853006");
    expect(result.stderr).not.toContain("123456789");
    expect(result.stderr).not.toContain("192.0.2.1");
  });
});
