# 10: Replace the Computer console with contextual control

**What to build:** Preserve safe Shared Screen coordination while replacing the visible engineering lease console with a quiet conversation-level Computer surface and contextual Takeover.

**Blocked by:** 02: Chat through a user-created Bot

**Status:** resolved

- [x] A recognizable Computer glyph is always available in the conversation Header and is visually quiet while inactive.
- [x] The control reflects only plain-language selected-Bot states such as using computer, waiting, needs you, or user control.
- [x] The control toggles a right-side Astryx `LayoutPanel` at every window width.
- [x] The compact preview opens an Astryx Lightbox modal only after the user selects its expand icon.
- [x] Take control appears only when human input is relevant and parks Bot desktop input before handing over the Shared Screen.
- [x] Return to Bot re-observes the Shared Screen before resuming the parked work.
- [x] A Bot waiting behind another shows Waiting for computer only on that Bot.
- [x] Observation remains available without input ownership and no two participants can interleave input.
- [x] The legacy omarchy-bot desktop approval gate is absent; Agent-native approvals remain unchanged.
- [x] Emergency control is absent from the idle Sidebar, appears immediately while computer input is active, and remains accessible while stopped so the user can resume deliberately.

## Answer

Implemented selected-Bot Computer state, globally serialized input, ownership-free observation, Takeover parking, Return-to-Bot re-observation, a right-side `LayoutPanel` at every window width, modal preview expansion, and emergency control that appears only while input is active or stopped.
