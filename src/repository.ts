import { seedWorkspace, workspaceSchema, type Workspace } from "./domain";
import {
  clearGitHubCredential,
  connectGitHubEditor,
  currentGitHubEditor,
  GitHubConflictError,
  hasGitHubCredential,
  loadGitHubWorkspace,
  saveGitHubWorkspace,
  type GitHubSettings,
  type SaveReceipt,
} from "./github-storage";

export const cloudMode = import.meta.env.VITE_DATA_MODE === "cloudbase";
export const githubMode = import.meta.env.VITE_DATA_MODE === "github";
export const LOCAL_KEY = "campus-console:workspace:v1";
const githubSettings: GitHubSettings = {
  repository: import.meta.env.VITE_GITHUB_REPOSITORY ?? "",
  branch: import.meta.env.VITE_GITHUB_BRANCH || "main",
  path: import.meta.env.VITE_GITHUB_DATA_PATH || "data/workspace.json",
  editorLogin: import.meta.env.VITE_GITHUB_EDITOR_LOGIN ?? "",
};
export type Snapshot = {
  workspace: Workspace;
  revision: number;
  receipt?: SaveReceipt;
};
export class ConflictError extends Error {
  constructor() {
    super(
      "数据已在其他窗口或设备更新。请先导出本地备份，再点击“重新读取”后重试。",
    );
  }
}
function validate(workspace: Workspace) {
  const parsed = workspaceSchema.parse(workspace);
  if (new TextEncoder().encode(JSON.stringify(parsed)).length > 750 * 1024)
    throw new Error("工作区超过 V1 的 750 KB 限额。请先导出归档后精简记录。");
  return parsed;
}
let cloudPromise: Promise<cloudbase.app.App> | undefined;
async function cloud() {
  if (!import.meta.env.VITE_CLOUDBASE_ENV_ID)
    throw new Error("缺少 CloudBase 环境标识，请按 README 配置后重新构建。");
  cloudPromise ??= import("@cloudbase/js-sdk").then(({ default: sdk }) =>
    sdk.init({ env: import.meta.env.VITE_CLOUDBASE_ENV_ID }),
  );
  return cloudPromise;
}
export async function currentUser(): Promise<string | null> {
  if (githubMode) return currentGitHubEditor(githubSettings);
  if (!cloudMode) return "本地工作区";
  const state = await (await cloud())
    .auth({ persistence: "local" })
    .getLoginState();
  return state?.user?.uid ?? null;
}
export async function login(email: string, password: string) {
  await (await cloud())
    .auth({ persistence: "local" })
    .signInWithEmailAndPassword(email, password);
}
export async function connectGitHub(token: string, remember = false) {
  if (!githubMode) throw new Error("当前没有启用 GitHub 数据模式。");
  return connectGitHubEditor(token, githubSettings, remember);
}
export async function logout() {
  if (cloudMode) await (await cloud()).auth().signOut();
  if (githubMode) clearGitHubCredential();
}
export function hasGitHubWriteAccess() {
  return !githubMode || hasGitHubCredential();
}
export async function loadWorkspace(): Promise<Snapshot> {
  if (githubMode) return loadGitHubWorkspace(githubSettings);
  if (!cloudMode) {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) {
      const snapshot = { workspace: seedWorkspace(), revision: 0 };
      localStorage.setItem(LOCAL_KEY, JSON.stringify(snapshot));
      return snapshot;
    }
    const stored = JSON.parse(raw);
    if (!Number.isInteger(stored.revision))
      throw new Error("本地数据版本无效，请保留数据并联系开发者。");
    return { workspace: validate(stored.workspace), revision: stored.revision };
  }
  const uid = await currentUser();
  if (!uid) throw new Error("请先登录");
  const db = (await cloud()).database();
  const result = await db
    .collection("campus_workspaces")
    .where({ _id: uid, _openid: uid })
    .get();
  const doc = result.data?.[0];
  if (doc)
    return {
      workspace: validate(JSON.parse(doc.payload)),
      revision: doc.revision,
    };
  const workspace = seedWorkspace();
  try {
    await db.collection("campus_workspaces").add({
      _id: uid,
      _openid: uid,
      revision: 0,
      payload: JSON.stringify(workspace),
      updatedAt: workspace.updatedAt,
    });
  } catch {
    const retry = await db
      .collection("campus_workspaces")
      .where({ _id: uid, _openid: uid })
      .get();
    if (retry.data?.[0])
      return {
        workspace: validate(JSON.parse(retry.data[0].payload)),
        revision: retry.data[0].revision,
      };
    throw new Error("云端初始化失败，请检查集合与安全规则。");
  }
  return { workspace, revision: 0 };
}
export async function saveWorkspace(
  workspace: Workspace,
  revision: number,
): Promise<Snapshot> {
  const valid = validate(workspace);
  const next = { workspace: valid, revision: revision + 1 };
  if (githubMode) {
    try {
      return await saveGitHubWorkspace(valid, revision, githubSettings);
    } catch (error) {
      if (error instanceof GitHubConflictError) throw new ConflictError();
      throw error;
    }
  }
  if (!cloudMode) {
    const save = () => {
      const stored = localStorage.getItem(LOCAL_KEY);
      if (stored && JSON.parse(stored).revision !== revision)
        throw new ConflictError();
      localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
      return next;
    };
    if (navigator.locks) return navigator.locks.request(LOCAL_KEY, save);
    return save();
  }
  const uid = await currentUser();
  if (!uid) throw new Error("登录已失效，请重新登录");
  const result = await (
    await cloud()
  )
    .database()
    .collection("campus_workspaces")
    .where({ _id: uid, _openid: uid, revision })
    .update({
      payload: JSON.stringify(valid),
      revision: revision + 1,
      updatedAt: valid.updatedAt,
    });
  if (result.updated !== 1) throw new ConflictError();
  return next;
}
export async function uploadEvidence(file: File) {
  if (!cloudMode)
    throw new Error("本地模式可填写证据链接；附件上传需配置云端存储。");
  if (file.size > 10 * 1024 * 1024) throw new Error("附件不能超过 10 MB");
  const uid = await currentUser();
  if (!uid) throw new Error("请先登录");
  const suffix =
    file.name
      .split(".")
      .pop()
      ?.replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 10) || "bin";
  // The SDK's browser implementation accepts File; its legacy declaration still says string.
  const result = await (
    await cloud()
  ).uploadFile({
    cloudPath: `evidence/${uid}/${crypto.randomUUID()}.${suffix}`,
    filePath: file as unknown as string,
  });
  return result.fileID;
}
export async function attachmentURL(fileID: string) {
  const result = await (await cloud()).getTempFileURL({ fileList: [fileID] });
  const url = result.fileList?.[0]?.tempFileURL;
  if (!url || !/^https:\/\//.test(url))
    throw new Error("无法获取附件，请检查存储权限。");
  return url;
}
