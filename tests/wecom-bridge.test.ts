import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { planImport, seedWorkspace } from "../src/domain";
describe("企业微信 CLI 只读适配器（离线模拟）", () => {
  it("完整翻页，按群与日期稳定去重，不把消息数当成员数", () => {
    mkdirSync("work", { recursive: true });
    const dir = mkdtempSync(resolve("work/cli-test-"));
    const out = resolve(dir, "candidates.json");
    try {
      const env = {
        ...process.env,
        WECOM_CLI_ENTRY: resolve("tests/fixtures/wecom-cli.mjs"),
      };
      const run = () =>
        execFileSync(
          process.execPath,
          [
            "scripts/wecom-sync.mjs",
            "pull",
            "--group",
            "验收测试群",
            "--days",
            "7",
            "--out",
            out,
          ],
          { env, encoding: "utf8", windowsHide: true },
        );
      run();
      const first = JSON.parse(readFileSync(out, "utf8"));
      const raw = readFileSync(out, "utf8");
      expect(raw).not.toContain("fixture-internal-group");
      expect(raw).not.toContain("fixture-internal-person");
      expect(first.rows[0].count).toBeNull();
      expect(first.rows[0].countMode).toBe("unknown");
      expect(first.rows[1].count).toBe(2);
      expect(first.rows[1].status).toBe("待核实");
      expect(first.rows[1].notes).toContain("第二页摘录");
      run();
      const second = JSON.parse(readFileSync(out, "utf8"));
      expect(second.rows[1].sourceKey).toBe(first.rows[1].sourceKey);
      const plan = planImport(seedWorkspace(), first);
      expect(plan.added).toBe(2);
      expect(planImport(plan.next, first).added).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("分页循环异常时终止，不交付不完整数据", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/wecom-sync.mjs", "pull", "--group", "验收测试群"],
      {
        env: {
          ...process.env,
          WECOM_CLI_ENTRY: resolve("tests/fixtures/wecom-cli.mjs"),
          QA_BAD_CURSOR: "1",
        },
        encoding: "utf8",
        windowsHide: true,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("fixture-internal-group");
    expect(result.stderr).toContain("未自动修改工作台");
  });
});
