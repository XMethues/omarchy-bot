import { WorkingTreeDetailQueryDto, WorkingTreeQueryDto } from "@omarchy-bot/protocol";
import type { WorkingTreeService } from "../modules/changes/workingTree.ts";

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

/** Bot-scoped read-only route; the server alone resolves the workspace root. */
export async function handleWorkingTreeRequest(
  req: Request,
  workingTrees: WorkingTreeService,
  pathname: string,
): Promise<Response | undefined> {
  const detailMatch = /^\/api\/bots\/([\w-]+)\/changes\/detail$/.exec(pathname);
  const summaryMatch = /^\/api\/bots\/([\w-]+)\/changes$/.exec(pathname);
  if ((detailMatch === null && summaryMatch === null) || req.method !== "GET") return undefined;

  const url = new URL(req.url);
  const entries = [...url.searchParams.entries()];
  const raw = Object.fromEntries(entries);
  if (detailMatch !== null) {
    const parsed = WorkingTreeDetailQueryDto.safeParse(raw);
    if (!parsed.success || entries.length !== Object.keys(raw).length) {
      return json({ error: "invalid Changes detail query" }, 400);
    }
    return json(await workingTrees.detail(detailMatch[1]!, parsed.data.threadId, parsed.data.path));
  }

  const parsed = WorkingTreeQueryDto.safeParse(raw);
  if (!parsed.success || entries.length !== Object.keys(raw).length) {
    return json({ error: "invalid Changes query" }, 400);
  }
  return json(await workingTrees.summary(summaryMatch![1]!, parsed.data.threadId));
}
