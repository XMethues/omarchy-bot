// Deterministic computer worker: 1x1 PNG screenshots, canned window list,
// refuses input actions without a lease token (defense in depth).
import { PROTOCOL_VERSION, readJsonl, writeJsonl } from "@omarchy-bot/agent-contract";
import type { ComputerActPayload, ComputerCommand, ComputerProbePayload, ComputerWorkerOutbound } from "@omarchy-bot/agent-contract";

const out = (m: ComputerWorkerOutbound) => writeJsonl(m);
const result = (requestId: string, ok: boolean, payload: ComputerActPayload | ComputerProbePayload | string) =>
  out(ok ? { requestId, ok: true, payload: payload as ComputerActPayload | ComputerProbePayload } : { requestId, ok: false, error: String(payload) });

const PNG_1PX_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

out({ type: "hello", v: PROTOCOL_VERSION, worker: "fake-computer", pid: process.pid });
const heartbeat = setInterval(() => out({ type: "heartbeat" }), 10_000);
heartbeat.unref?.();

readJsonl(Bun.stdin.stream(), (raw) => {
  const cmd = raw as ComputerCommand;
  switch (cmd.type) {
    case "probe":
      result(cmd.requestId, true, { agentId: "computer", installed: true, agentVersion: "fake-1.0.0", sdkOk: true });
      break;
    case "act": {
      const needsLease = ["focus_window", "click", "type", "key", "scroll", "open_app", "open_url"].includes(cmd.action.name);
      if (needsLease && !cmd.lease) return result(cmd.requestId, false, "input action without lease token");
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
