// Deterministic Bot Screen worker: 1x1 PNG screenshots, canned window list,
// and fail-closed input authority checks.
import { PROTOCOL_VERSION, readJsonl, writeJsonl } from "@omarchy-bot/agent-contract";
import type { ComputerActPayload, ComputerCommand, ComputerWorkerOutbound } from "@omarchy-bot/agent-contract";
import { isSurfaceId } from "@omarchy-bot/domain";

const out = (m: ComputerWorkerOutbound) => writeJsonl(m);
const result = (requestId: string, ok: boolean, payload: ComputerActPayload | string) =>
  out(ok ? { requestId, ok: true, payload: payload as ComputerActPayload } : { requestId, ok: false, error: String(payload) });

const PNG_1PX_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

out({ type: "hello", v: PROTOCOL_VERSION, worker: "fake-computer", pid: process.pid });
const heartbeat = setInterval(() => out({ type: "heartbeat" }), 10_000);
heartbeat.unref?.();

const expectedSurfaceId = process.env.OMARCHY_BOT_SURFACE_ID;
const expectedRuntimeGeneration = Number(process.env.OMARCHY_BOT_RUNTIME_GENERATION);

readJsonl(Bun.stdin.stream(), (raw) => {
  const cmd = raw as ComputerCommand;
  switch (cmd.type) {
    case "act": {
      if (!isSurfaceId(expectedSurfaceId ?? "") || cmd.surfaceId !== expectedSurfaceId) {
        result(cmd.requestId, false, "command Surface does not match worker context");
        break;
      }
      if (cmd.runtimeGeneration !== expectedRuntimeGeneration) {
        result(cmd.requestId, false, "runtime generation does not match worker context");
        break;
      }
      if (cmd.inputAuthority !== undefined && cmd.inputAuthority.surfaceId !== cmd.surfaceId) {
        result(cmd.requestId, false, "input authority Surface does not match command Surface");
        break;
      }
      const needsAuthority = ["focus_window", "click", "type", "key", "scroll", "open_app", "open_url"].includes(cmd.action.name);
      if (needsAuthority && !cmd.inputAuthority) return result(cmd.requestId, false, "input action without Bot Screen authority");
      switch (cmd.action.name) {
        case "screenshot":
          result(cmd.requestId, true, { image: { mediaType: "image/png", base64: PNG_1PX_BASE64 } });
          break;
        case "list_windows":
          result(cmd.requestId, true, { windowList: [{ id: "1", title: "Fake Editor", appId: "org.fake.Editor", focused: true }] });
          break;
        case "observe":
          result(cmd.requestId, true, { text: "window 'Fake Editor': button 'Save', text field 'Untitled'" });
          break;
        default:
          result(cmd.requestId, true, { text: `did ${cmd.action.name} at ${new Date().toISOString()}` });
      }
      break;
    }
    case "shutdown":
      result(cmd.requestId, true, { done: true });
      setTimeout(() => process.exit(0), 50);
      break;
  }
}, () => process.exit(0));
