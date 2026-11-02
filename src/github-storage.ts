import { seedWorkspace, workspaceSchema, type Workspace } from "./domain";

export type GitHubSettings = {
  repository: string;
  branch: string;
  path: string;
  editorLogin: string;
};
export type GitHubSnapshot = { workspace: Workspace; revision: number };
export class GitHubConflictError extends Error {
  constructor() {
    super("GitHub 数据已在其他设备更新。请重新读取后再提交。");
  }
}
class GitHubAuthorizationError extends Error {
  constructor(readonly status: number) {
    super("GitHub 未授权此操作，请检查令牌有效期、账号和仓库 Contents 权限。");
  }
}

const TOKEN_KEY = "campus-console:github-edit-token:v1";
const API = "https://api.github.com";

function repositoryParts(settings: GitHubSettings) {
  const [owner, repo, ...rest] = settings.repository.split("/");
  if (!owner || !repo || rest.length)
    throw new Error("GitHub 仓库配置必须为 owner/repository。");
  if (!/^[A-Za-z0-9_.-]+$/.test(settings.branch))
    throw new Error("GitHub 分支配置无效。");
  if (
    !settings.path ||
    settings.path.startsWith("/") ||
    settings.path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("GitHub 数据文件路径无效。");
  if (!settings.editorLogin)
    throw new Error("缺少可编辑的 GitHub 账号配置。");
  return { owner, repo };
}

function fileURL(settings: GitHubSettings) {
  const { owner, repo } = repositoryParts(settings);
  return `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${settings.path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function rawURL(settings: GitHubSettings) {
  const { owner, repo } = repositoryParts(settings);
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${settings.branch}/${settings.path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function headers(token?: string) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function responseError(response: Response) {
  let message = "GitHub 请求失败";
  try {
    const body = (await response.json()) as { message?: string };
    if (body.message) message = body.message;
  } catch {
    // Keep a stable user-facing error when the response has no JSON body.
  }
  if (response.status === 401 || response.status === 403)
    return new GitHubAuthorizationError(response.status);
  return new Error(`${message}（HTTP ${response.status}）`);
}

function decodeContent(encoded: string) {
  const binary = atob(encoded.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeContent(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function parseSnapshot(text: string): GitHubSnapshot {
  const data = JSON.parse(text) as Partial<GitHubSnapshot>;
  if (!Number.isInteger(data.revision) || (data.revision ?? -1) < 0)
    throw new Error("GitHub 数据文件版本无效，未覆盖现有数据。");
  const workspace = workspaceSchema.parse(data.workspace);
  if (new TextEncoder().encode(JSON.stringify(workspace)).length > 750 * 1024)
    throw new Error("工作区超过 V1 的 750 KB 限额。请先导出归档后精简记录。");
  return { workspace, revision: data.revision! };
}

function storedToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function hasGitHubCredential() {
  return !!storedToken();
}

export function clearGitHubCredential() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // The public read-only mode remains available if browser storage is disabled.
  }
}

export async function connectGitHubEditor(
  tokenInput: string,
  settings: GitHubSettings,
) {
  const token = tokenInput.trim();
  if (!token.startsWith("github_pat_"))
    throw new Error("请使用 GitHub 细粒度个人访问令牌（github_pat_ 开头）。");
  const { owner, repo } = repositoryParts(settings);
  const userResponse = await fetch(`${API}/user`, { headers: headers(token) });
  if (!userResponse.ok) throw await responseError(userResponse);
  const user = (await userResponse.json()) as { login?: string };
  if (!user.login || user.login.toLowerCase() !== settings.editorLogin.toLowerCase())
    throw new Error(`请使用 GitHub 账号 ${settings.editorLogin} 的令牌。`);

  const repoResponse = await fetch(
    `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    { headers: headers(token) },
  );
  if (!repoResponse.ok) throw await responseError(repoResponse);
  const repository = (await repoResponse.json()) as {
    permissions?: { push?: boolean };
  };
  if (repository.permissions?.push !== true)
    throw new Error("此 GitHub 账号没有该仓库的写入权限。");

  const dataResponse = await fetch(
    `${fileURL(settings)}?ref=${encodeURIComponent(settings.branch)}`,
    { headers: headers(token), cache: "no-store" },
  );
  if (!dataResponse.ok)
    throw new Error(
      "无法读取 GitHub 数据文件。请确认文件路径正确，并为此仓库授予 Contents 读写权限。",
    );
  const dataFile = (await dataResponse.json()) as {
    content?: string;
    encoding?: string;
  };
  if (!dataFile.content || dataFile.encoding !== "base64")
    throw new Error("GitHub 数据文件不可读取或格式无效。");
  parseSnapshot(decodeContent(dataFile.content));

  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    throw new Error("浏览器无法保存本次会话令牌，请允许此网站使用会话存储。");
  }
  return user.login;
}

export async function currentGitHubEditor(settings: GitHubSettings) {
  const token = storedToken();
  if (!token) return null;
  try {
    const response = await fetch(`${API}/user`, { headers: headers(token) });
    if (!response.ok) return null;
    const user = (await response.json()) as { login?: string };
    return user.login?.toLowerCase() === settings.editorLogin.toLowerCase()
      ? user.login
      : null;
  } catch {
    return null;
  }
}

async function apiSnapshot(settings: GitHubSettings, token: string) {
  const response = await fetch(
    `${fileURL(settings)}?ref=${encodeURIComponent(settings.branch)}`,
    { headers: headers(token), cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw await responseError(response);
  const file = (await response.json()) as { content?: string; encoding?: string };
  if (!file.content || file.encoding !== "base64")
    throw new Error("GitHub 数据文件格式不受支持。");
  return parseSnapshot(decodeContent(file.content));
}

export async function loadGitHubWorkspace(settings: GitHubSettings) {
  const token = storedToken();
  if (token) {
    try {
      const snapshot = await apiSnapshot(settings, token);
      if (snapshot) return snapshot;
      return { workspace: seedWorkspace(), revision: 0 };
    } catch (error) {
      if (!(error instanceof GitHubAuthorizationError)) throw error;
      if (error.status === 401) clearGitHubCredential();
      // Missing edit authorization must not prevent anonymous public reads.
    }
  }
  const response = await fetch(rawURL(settings), { cache: "no-store" });
  if (response.status === 404) return { workspace: seedWorkspace(), revision: 0 };
  if (!response.ok) throw await responseError(response);
  return parseSnapshot(await response.text());
}

export async function saveGitHubWorkspace(
  workspace: Workspace,
  revision: number,
  settings: GitHubSettings,
): Promise<GitHubSnapshot> {
  const token = storedToken();
  if (!token)
    throw new Error("当前是 GitHub 公开只读模式。请先在“数据中心”连接编辑权限。");
  const getResponse = await fetch(
    `${fileURL(settings)}?ref=${encodeURIComponent(settings.branch)}`,
    { headers: headers(token), cache: "no-store" },
  );
  let sha: string | undefined;
  if (getResponse.ok) {
    const existing = (await getResponse.json()) as {
      sha?: string;
      content?: string;
      encoding?: string;
    };
    sha = existing.sha;
    if (!sha || !existing.content || existing.encoding !== "base64")
      throw new Error("GitHub 未返回有效文件版本，无法安全保存。");
    const current = parseSnapshot(decodeContent(existing.content));
    if (current.revision !== revision) throw new GitHubConflictError();
  } else if (getResponse.status === 404) {
    if (revision !== 0) throw new GitHubConflictError();
  } else {
    if (getResponse.status === 401) clearGitHubCredential();
    throw await responseError(getResponse);
  }
  const next = { workspace, revision: revision + 1 };
  const putResponse = await fetch(fileURL(settings), {
    method: "PUT",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Update campus workspace (${next.revision})`,
      content: encodeContent(JSON.stringify(next)),
      ...(sha ? { sha } : {}),
      branch: settings.branch,
    }),
  });
  if (putResponse.status === 409 || putResponse.status === 422)
    throw new GitHubConflictError();
  if (putResponse.status === 401) clearGitHubCredential();
  if (!putResponse.ok) throw await responseError(putResponse);
  return next;
}
