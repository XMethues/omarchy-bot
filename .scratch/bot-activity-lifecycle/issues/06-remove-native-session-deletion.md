# 06: Remove Native Session deletion contracts

**What to build:** Make the local-only deletion boundary explicit by removing Native Session deletion from Agent capabilities, worker commands, Bot deletion results, and retry state.

**Blocked by:** 03: Delete inactive Bots locally

**Status:** resolved

- [x] Agent capability inventory no longer includes a Native Session deletion field.
- [x] Worker commands no longer include Native Session deletion, and production and fake Agent adapters no longer handle or advertise it.
- [x] Bot deletion never branches on Agent support and never starts an Agent worker.
- [x] Bot deletion results describe only Omarchy Bot-owned cleanup and no longer expose native support, skipped-session counts, native deletion counts, or native failure stages.
- [x] Native Session deletion checkpoints and native-cleanup retry state are removed while local filesystem and database retry behavior remains intact.
- [x] Native Thread actions remain capability-driven and are not accidentally removed with the separate Native Session deletion contract.
- [x] Agent Readiness, steering, abort, attachment modalities, native event families, and remaining capability inventory behavior are unchanged.
- [x] User-facing deletion confirmation continues to state that Agent-owned Native Sessions may remain.
- [x] Integration and conformance coverage proves the reduced capability and command contracts and the unchanged remaining Agent behavior.
- [x] Deletion coverage proves success for a non-ready Agent and proves that an Agent-owned Native Session survives local Bot deletion.
- [x] Documentation consistently describes Bot deletion as local-only and does not claim that Pi or another Agent supports deletion through Omarchy Bot.

## Answer

Native Session deletion is no longer part of the Agent capability, worker, result, or retry contracts. Bot deletion removes local mappings without acquiring an Agent worker, and the Agent-owned Native Session remains available independently.