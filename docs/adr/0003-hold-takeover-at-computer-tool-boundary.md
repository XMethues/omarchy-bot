# Hold Takeover at the Agent's computer-tool boundary

Supported Agents do not expose a general operation that pauses an arbitrary active turn and later resumes the same execution. To preserve same-turn continuation without weakening native Agent behavior, every Agent desktop action will pass through an Omarchy-owned, sequential Computer Broker tool: Takeover waits for the current atomic desktop action to quiesce, keeps that exact tool invocation pending while the user controls the owning Bot Screen, then captures a fresh screenshot and window context and resolves the same invocation when the user selects “I'm done.”

Takeover is therefore available only while the selected Bot has a Broker-owned computer tool in progress. It does not claim to freeze model reasoning or an unrelated tool. Agent abort cancels the pending invocation through the Agent's native cancellation path; daemon or Agent-worker restart cannot reconstruct it and fails the affected turn honestly.

This decision also closes an existing enforcement gap: Agent desktop tools currently bypass `ComputerBroker`, so the documented per-Screen arbitration cannot yet guarantee that a Bot and the user are mutually exclusive.