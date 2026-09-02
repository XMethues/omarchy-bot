# Prompt-authored and uploaded Bot avatars

A Bot Profile supports both locally uploaded images and animated DiceBear avatars. Newly created Bots receive a deterministic generated avatar; the profile editor lets the user upload an image or describe a new avatar with a prompt.

For prompt generation, the Bot's selected Agent returns a constrained, versioned Avatar Recipe containing supported DiceBear options. Omarchy Bot validates the recipe and renders the SVG itself. Agent-produced SVG, HTML, scripts, and remote image URLs are never rendered directly. The prompt-generation turn is a profile operation, not a Thread message.

Generated avatars may use their native restrained animation while the Bot is selected or working. Uploaded avatars receive only a shared container-level activity treatment so both sources communicate the same state. In the transcript, the active assistant avatar may animate while output is streaming and settles when the turn completes. Reduced-motion mode replaces movement with a static state indicator.

Consequences: avatar uploads are re-encoded and stored locally; Avatar Recipes store their DiceBear version, style, seed, and validated options for deterministic rendering; animation must never run continuously for every Bot or move message content itself.
