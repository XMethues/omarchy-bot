# User-created Bots reference Agent backends

A Bot is a user-created assistant with its own identity and configuration, while an Agent is a supported execution backend such as Pi or Claude. We decided that each Bot keeps an immutable Agent reference and that multiple Bots may use the same Agent, rather than treating the nine Agent runtimes as the nine visible Bots; this matches the user's assistant-oriented mental model and lets the sidebar contain only assistants they intentionally created.

Consequences: Bot IDs can no longer alias Agent IDs, Agent installation/readiness belongs to a separate registry, and existing enabled Agent-backed records must be migrated into user-created Bots without losing their threads.
