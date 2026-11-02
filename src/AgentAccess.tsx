import { useEffect, useLayoutEffect, useRef } from "react";
import {
  automationTools,
  createAutomation,
  type AutomationAPI,
  type AutomationHost,
  type WebMcpTool,
} from "./automation";
type Registry = {
  registerTool(
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ): void | Promise<void>;
};
declare global {
  interface Window {
    campusWorkbench?: AutomationAPI;
  }
}

export default function AgentAccess({ host }: { host: AutomationHost }) {
  const latest = useRef(host);
  useLayoutEffect(() => {
    latest.current = host;
  }, [host]);
  useEffect(() => {
    const api = createAutomation({
      mode: host.mode,
      getSnapshot: () => latest.current.getSnapshot(),
      isEditing: () => latest.current.isEditing(),
      write: (workspace, revision) => latest.current.write(workspace, revision),
      openPage: (input) => latest.current.openPage(input),
    });
    window.campusWorkbench = api;
    const registry = (document as Document & { modelContext?: Registry })
      .modelContext;
    const lifecycle = new AbortController();
    if (typeof registry?.registerTool === "function") {
      for (const tool of automationTools(api)) {
        try {
          void Promise.resolve(
            registry.registerTool(tool, { signal: lifecycle.signal }),
          ).catch(() => {
            /* The ordinary accessible UI and browser API remain available. */
          });
        } catch {
          /* Feature availability must not block the workspace. */
        }
      }
    }
    return () => {
      lifecycle.abort();
      if (window.campusWorkbench === api) delete window.campusWorkbench;
    };
  }, []);
  return null;
}
