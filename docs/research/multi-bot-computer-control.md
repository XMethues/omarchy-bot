# Multi-Bot computer control and human takeover

Research question: how should several Bots and the user share one Omarchy desktop without exposing an engineering-oriented lease UI?

## Findings

### Grok Bot does coordinate computer control, but at a different scope

Grok Bot assigns one persistent computer to the user. Files, browser sessions, cookies, and command-line credentials are shared across all Bots, but **each Bot gets its own screen**. Bots can therefore use desktop tools in parallel, while each screen permits only one computer-use task at a time. The screen is a work surface, not a security boundary. [xAI: Use the computer and apps](https://docs.x.ai/grok-bot/computer-and-apps)

The computer is opened contextually from a conversation. Normal viewing does not expose a lease holder, TTL, or queue. Takeover is nevertheless an explicit product behavior: when a password, passkey, 2FA code, CAPTCHA, payment, identity check, or other human-only step blocks work, the user opens Agent Computer, takes control, completes the step, returns control, and tells the Bot to continue. [xAI: Use the computer and apps](https://docs.x.ai/grok-bot/computer-and-apps) · [xAI: Approvals, security, and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy)

Grok also lets the user redirect active work with a new message and stop it with a direct “Stop now” message. [xAI: Message and collaborate](https://docs.x.ai/grok-bot/chat-and-collaboration)

**Implication:** the supplied screenshot shows a normal observation state, not evidence that Grok has no takeover mechanism. Grok avoids a *global* visible lease because parallelism is isolated by per-Bot screens.

### Human-in-the-loop products expose takeover contextually

Browserbase Live View is an embeddable session surface where a user can watch, click, type, scroll, and “instantly take control or provide input.” It supports both read-only and read/write embedding. Its public documentation does not promise automatic arbitration between concurrent automation and human input; that coordination remains the host application's responsibility. [Browserbase: Session live view](https://docs.browserbase.com/platform/browser/observability/session-live-view)

OpenAI's computer-use guide requires a human handoff for selected sensitive steps and action-time confirmation for consequential actions. Anthropic's computer-use protocol requires action batches to execute in order rather than concurrently. These products differ in policy, but both treat computer interaction as an ordered loop with explicit human boundaries rather than uncontrolled simultaneous input. [OpenAI: Computer use](https://developers.openai.com/api/docs/guides/tools-computer-use) · [Anthropic: Computer use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)

### The current Omarchy backend cannot safely imitate Grok's parallel screens

`computer-use-linux` describes desktop input as stateful and explicitly says to avoid concurrent tool calls against the MCP server. It also warns that untargeted typing goes to the compositor-focused window. Target-aware actions reduce mistakes but do not create independent input seats or per-Bot screens. The current package exposes no documented physical-user activity event that omarchy-bot could use for reliable automatic takeover. [computer-use-linux README](https://github.com/agent-sh/computer-use-linux#readme) · local integration instructions: `/home/colin/.pi/agent/npm/node_modules/@agent-sh/computer-use-linux/skills/computer-use-linux/SKILL.md`

The current implementation reflects that limitation:

- `apps/daemon/src/modules/computer/broker.ts` serializes global input and keeps its lease and queue mechanics internal.
- `apps/web/src/components/ComputerSheet.tsx` exposes only contextual state, preview, **Take control**, and **Return to Bot**.
- `apps/web/src/components/EmergencyComputerControl.tsx` provides the separate global fail-safe.
- No implemented service claims to detect physical keyboard or pointer activity and transfer control automatically.

Removing coordination now would allow focus changes, typing, and clicks from separate Bots to interleave on one real desktop. Claiming seamless automatic takeover now would also exceed what the current input backend can verify.

## Options

| Option | Safety | UX | Current feasibility |
| --- | --- | --- | --- |
| Remove all arbitration | Weak; input can interleave | Superficially simple | Easy but incorrect |
| Automatic takeover on any human input | Potentially strong | Closest to invisible handoff | No reliable input-activity source today |
| Invisible arbiter with contextual takeover | Strong | Quiet in normal use | Feasible now |
| Independent screen per Bot, as Grok uses | Strong and parallel | Best long-term model | Requires new screen/session infrastructure |

## Recommendation

### Current Omarchy desktop: invisible arbiter, contextual controls

Keep the global input arbiter internally because all Bots currently target one real compositor and input seat. Do not expose it as a lease in the product language.

1. Open **Computer** as a Sheet from the selected Bot's conversation.
2. In the normal state, show only the current preview, active application, and a plain-language activity state. Show no lease holder, TTL, queue depth, Take over, I'm done, or Emergency stop row.
3. When that Bot needs human input, show one prominent **Take control** action in the Sheet and an Action Needed message in the conversation.
4. While the user has control, replace it with **Return to Bot**. Re-observe before resuming the Bot.
5. If another Bot is waiting, show **Waiting for computer** on that Bot only; do not expose queue mechanics.
6. Keep **Emergency stop** as a global fail-safe in an overflow/settings menu or system shortcut. Surface a persistent warning and **Resume** only while the stop is active.
7. A new message steers active Bot work; archive, delete, timeout, and emergency flows retain internal cancellation.
8. Preserve the selected Agent's native capabilities and native approvals. The arbiter serializes desktop input; it does not add a separate omarchy-bot authorization policy.

This provides the quiet Grok-like normal state while remaining honest about the current single-screen backend.

### Later: per-Bot screens

To reach Grok-level desktop parallelism, give every Bot an independent screen/session while keeping the shared filesystem and intended account-level resources. Then move arbitration from one global desktop lock to one lock per Bot screen. Hyprland workspaces alone should not be assumed to provide this isolation: they still share compositor focus and the same input seat.

Treat per-Bot screens as a separate architecture investigation. It must decide how browser profiles, login state, screenshots, target routing, process ownership, and user takeover work before replacing the global arbiter.

## Conclusion

The implemented solution is an internal global input arbiter with a quiet Computer Sheet and takeover controls rendered only when the state requires them. Grok's exact parallel model becomes appropriate only after omarchy-bot has genuine per-Bot screens.
