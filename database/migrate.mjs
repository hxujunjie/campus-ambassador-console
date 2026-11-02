import cloudbase from "@cloudbase/node-sdk";
const env = process.env.CLOUDBASE_ENV_ID;
const secretId = process.env.TENCENTCLOUD_SECRETID;
const secretKey = process.env.TENCENTCLOUD_SECRETKEY;
if (!env || !secretId || !secretKey) {
  console.error(
    "请在部署终端设置 CLOUDBASE_ENV_ID、TENCENTCLOUD_SECRETID、TENCENTCLOUD_SECRETKEY。不要写入前端环境文件。",
  );
  process.exit(1);
}
try {
  const app = cloudbase.init({
    env,
    secretId,
    secretKey,
    ...(process.env.TENCENTCLOUD_SESSIONTOKEN
      ? { sessionToken: process.env.TENCENTCLOUD_SESSIONTOKEN }
      : {}),
  });
  const db = app.database();
  try {
    await db.createCollection("campus_workspaces");
    console.log("已创建工作区集合。");
  } catch (error) {
    if (!/exist/i.test(String(error.code))) throw error;
    console.log("工作区集合已存在，保留原数据。");
  }
  console.log(
    "结构迁移完成。请在控制台应用 database/security-rules.json 与 database/storage-rules.json；迁移不开放任何公共权限。",
  );
} catch {
  console.error(
    "数据库迁移失败。请检查部署账号权限、环境和凭据有效性。未输出凭据或请求内容。",
  );
  process.exitCode = 1;
}
