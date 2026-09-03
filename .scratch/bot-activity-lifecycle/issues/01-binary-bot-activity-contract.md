# 01: Make Bot Activity binary

**What to build:** Give users one truthful Bot Activity signal across the workspace: a Bot is active while any of its Threads has unfinished work and inactive otherwise, while Agent Readiness and operational errors remain separate.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Public Bot projections expose only `active` or `inactive`; removed Bot activity values are neither emitted nor accepted.
- [x] A Bot becomes active when any Thread starts a Turn and remains active through working, waiting for input, and waiting for computer access.
- [x] A Bot becomes inactive only when every Turn is completed, cancelled, or failed.
- [x] Concurrent work in separate Threads aggregates correctly without changing Thread concurrency.
- [x] Agent Readiness changes never change Bot Activity, while creation still rejects a non-ready Agent.
- [x] A known non-ready Agent disables sending and shows its reason and recovery guidance in a contextual card immediately above the Composer.
- [x] Send, Turn, and model-provider failures make the affected Turn terminal, update aggregate Bot Activity, and use the same above-Composer error-card interaction.
- [x] The error card offers applicable Retry and Close actions and remains until closed, a retry succeeds, or a new Turn is sent.
- [x] Operational failures are not duplicated as permanent message-history entries.
- [x] Detailed Agent Readiness and Turn states remain available to the behavior that owns them.
- [x] Daemon HTTP integration coverage proves the binary contract, all transitions, concurrent Thread aggregation, and Agent Readiness separation.
- [x] Browser coverage proves Composer disablement, error placement, recovery actions, and absence of duplicate history errors.

## Answer

Bot Activity is now a binary projection derived from nonterminal Turns across every Thread. Agent Readiness and terminal Turn failure details stay separately actionable through one contextual Composer card, while operational failures are omitted from message history.