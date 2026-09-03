# Grok Bot computer control and handoff behavior

Research date: 2026-09-03

## Direct answer: Bot A versus Bot B

**Bot A does not own the account's entire cloud computer.** xAI describes one persistent computer assigned to the user, with shared files, credentials, cookies, and browser sessions, but a **separate screen for each Bot**. Multiple Bots can use their own screens in parallel; the one-computer-use-task limit applies to one Bot's screen, not to the whole account. [C1] [F1]

Therefore, if the user takes over Bot A's screen and then selects Bot B, the defensible product model is:

1. Bot A's blocked computer-use step remains associated with Bot A's screen and conversation.
2. Selecting Bot B must not transfer Bot A's blocked task or screen ownership to Bot B.
3. Bot B can use its own screen in parallel, subject to Bot B's one-active-computer-use-task limit. [C1] [F1]

Items 1 and 2 are an **inference from xAI's documented per-Bot-screen model**, not a documented navigation guarantee. xAI does not publicly say whether the shipping app keeps A's takeover full-screen, closes it, shows B's screen while retaining human-control mode, or prevents conversation switching. The official public marketing demonstrator currently keeps the takeover overlay open when B is selected, changes the dialog from “Sales Outbound's screen” to “Inbox Manager's screen,” and replaces A's instruction with the generic “You're in control.” [P1] That demonstrator is scripted marketing UI, not an authenticated production session, so this is evidence about the public demonstration—not a safe contract for the desktop or mobile app.

## Verified behavior

### Scope and concurrency

- The durable computer is **account/user-scoped**: all Bots share files, browser sessions, cookies, and command-line credentials. A Bot is not a security boundary. [C1] [S1]
- The interactive work surface is **Bot-scoped**: each Bot gets its own screen, several Bots can use desktop/browser tools in parallel, and one Bot can run only one computer-use task on its screen at a time. [C1] [F1]
- The computer view is opened **from a conversation**. xAI says its preview shows clicks, typing, navigation, and current status; leaving the preview does not stop the cloud work. [C1]
- xAI does not explicitly state whether control is scoped to a whole conversation, one turn, or one low-level computer-use operation. The public demonstrator attaches takeover controls to an individual `computer-use` transcript entry and labels the expanded dialog with the selected Bot's name, which is evidence for a Bot/task-local handoff in the demonstrator only. [P1] [P2]

### Compact preview versus expanded control

The official interactive demonstrator on `x.ai/bot` shows two layers:

1. A compact **Computer** card inside the Bot transcript. It contains a status badge (`Action needed`, `You're in control`, `Working`, or `Done`), the current instruction, and a 16:10 screen preview. Clicking the card title or preview opens the corresponding computer-use entry. [P1] [P2]
2. An expanded modal labelled **“<Bot name>'s screen.”** Normal expanded viewing has a close control. Takeover mode adds a full-screen shell and bottom banner containing the blocking instruction (or “You're in control”) and **“I'm done, continue.”** [P1] [P3]

This compact/expanded structure is directly observable in the public demonstrator and its first-party shipped page bundle. The public docs promise a conversation-launched preview and takeover, but do not specify these exact layouts or labels. [C1] [G1]

### When human takeover starts

- The Bot may ask for takeover when blocked by a password/passkey, two-factor authentication, CAPTCHA, payment or identity check, or a site that requires a human. [C1]
- The documented sequence is: open **Agent Computer** from the conversation, choose the takeover control, complete the blocked step, return control to the Bot, and tell the Bot to continue. [G1] [S1]
- In the public demonstrator, an `Action needed` or `handed-over` card exposes **Take over** and **I'm done**. Choosing **Take over** marks that transcript entry `handed-over` and opens its screen in takeover mode; the status label becomes **“You're in control.”** [P2]

### What “I'm done” proves—and does not prove

- The expanded demonstrator labels its button **“I'm done, continue.”** The scripted hero animation uses that moment to hand back the computer, change the entry to `Working`, close the overlay, release the pending computer-use wait, and let the Agent continue. [P3]
- That establishes the intended marketing flow: finish the human-only step, return input control, and continue the same Bot's task. It does **not** establish the production app's transport/state-machine contract.
- The public docs are more conservative: they separately instruct the user to **return control and tell the Bot to continue**. They do not say that pressing an “I'm done” button by itself automatically submits a chat turn or resumes execution. [C1] [S1]
- The public page's click handler is also demo-specific: a direct user click on its full-screen button marks the simulated card `Done`, while the scripted pointer animation invokes a separate hand-back/resume action. This discrepancy is another reason not to treat the marketing demonstrator as production API behavior. [P2] [P3]

## Bot A/B scenario matrix

| Scenario | Answer | Confidence |
| --- | --- | --- |
| A is doing computer work; user merely opens or leaves A's compact preview | A keeps working. [C1] | Verified |
| A asks for a sensitive step; user chooses takeover | The user controls A's screen to complete the blocked step. [C1] [G1] | Verified |
| User completes the step | Return control, then tell A to continue. [C1] [S1] | Verified documented flow |
| B is selected while A's takeover is active | The shipping app's exact visual/navigation behavior is not publicly documented. | Unknown |
| Does selecting B give B ownership of A's task/screen? | No under the documented model: screens are per Bot; A's task does not become B's. [C1] [F1] | Strong inference |
| Can B use the computer while A waits? | Yes on B's separate screen; several Bots can use screens in parallel. [C1] [F1] | Verified |
| What does the public demonstrator do on an A-to-B switch during takeover? | It retains takeover mode but redraws the overlay as B's screen with a generic control banner. [P1] | Directly observed demo behavior; not production-verified |

## Explicit unknowns

No first-party public source found on 2026-09-03 specifies:

- whether the production desktop/mobile app permits Bot or conversation switching during active human takeover;
- whether A stays paused indefinitely, times out, or receives a notification when the user navigates away;
- whether returning to A restores the same expanded takeover surface automatically;
- whether production **“I'm done”** alone resumes the Bot, or whether a separate chat message is always required;
- whether takeover is leased to a conversation, a turn, a particular computer-use call, or the Bot's screen at the backend protocol level;
- how a group conversation chooses among member Bots' separate screens.

These should remain product decisions or validation questions rather than be inferred from the shared-computer wording.

## Sources

All sources accessed 2026-09-03.

- [C1] xAI, [Use the computer and apps](https://docs.x.ai/grok-bot/computer-and-apps) — account-level persistence, per-Bot screens, parallelism, preview behavior, and sensitive-step takeover.
- [F1] xAI, [Frequently asked questions](https://docs.x.ai/grok-bot/faq#can-several-bots-work-at-the-same-time) — one screen per Bot and one computer-use task per Bot screen.
- [G1] xAI, [Get started: Sign in to the tools it needs](https://docs.x.ai/grok-bot/get-started#5-sign-in-to-the-tools-it-needs) — conversation-launched takeover and return-control steps.
- [S1] xAI, [Approvals, security, and privacy: Enter passwords and verification codes yourself](https://docs.x.ai/grok-bot/approvals-security-and-privacy#enter-passwords-and-verification-codes-yourself) — return control and separately tell the Bot to continue.
- [P1] xAI, [Grok Bot product page](https://x.ai/bot) — official interactive marketing demonstrator; compact card, expanded screen, takeover labels, and directly exercised A-to-B selection behavior.
- [P2] xAI product-page bundle, [computer card and demo state actions](https://x.ai/_next/static/chunks/3ovf5qn1saq-q.js?dpl=fabac5edbfe6850288c66466d486bbe42867a28e) — card statuses/actions and transcript-entry-scoped simulated state. This deployment-hashed URL is volatile.
- [P3] xAI product-page bundle, [expanded screen and scripted hand-back flow](https://x.ai/_next/static/chunks/3kfz4r8um6_zx.js?dpl=fabac5edbfe6850288c66466d486bbe42867a28e) — “I'm done, continue,” takeover modal, and scripted resume behavior. This deployment-hashed URL is volatile.
