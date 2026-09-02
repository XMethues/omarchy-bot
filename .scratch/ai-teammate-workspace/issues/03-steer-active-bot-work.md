# 03: Steer active Bot work

**What to build:** Let the user send another message while a Bot is working and redirect the same native Agent session at its next safe boundary, without aborting the turn, opening a replacement session, or exposing a permanent Stop control.

**Blocked by:** 02: Chat through a user-created Bot

**Status:** ready-for-agent

- [ ] The Agent worker contract can represent native steering separately from normal send and abort.
- [ ] Sending to an idle Thread starts a normal turn; sending to its active turn invokes the adapter's tested steering operation.
- [ ] Pi uses its native steering API and retains the same native session and work context.
- [ ] The steering user message appears in transcript order immediately and is correlated with the active turn.
- [ ] Steering waits for the Agent's safe native boundary rather than interrupting an atomic tool action.
- [ ] A failed or unavailable steer is reported inline without silently aborting and restarting.
- [ ] The Composer stays available during work and contains no permanent Stop button.
- [ ] Worker conformance and API integration tests distinguish send, steer, and explicit abort behavior.
