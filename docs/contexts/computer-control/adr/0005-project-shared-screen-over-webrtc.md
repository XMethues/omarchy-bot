# Project the Shared Screen over WebRTC instead of creating Bot Screens

_Superseded by [ADR 0007](./0007-provision-nested-hyprland-per-bot.md)._

The Computer Surface will mirror one user-selected physical display from the current Shared Screen; it will not create an independent desktop. The compact Computer Preview remains read-only and low-frequency, while expanding it starts Web Control through an XDG ScreenCast/PipeWire capture path and WebRTC media, targeting at least 15 FPS and 200 ms median input-to-visible-feedback latency on a 1080p LAN reference setup.

This keeps the first release aligned with Omarchy's real desktop and avoids pretending that a Hyprland workspace is a Bot Screen. The public contracts will nevertheless carry an opaque `surfaceId`; there is one persistent Shared Screen identity now, leaving room for genuine per-Bot Screens later without another identity cutover.

Consequences: the current one-shot screenshot/MCP path remains suitable only for Computer Preview and fallback observation. Expanded Web Control requires a native transport helper, versioned capture geometry, a selected-output lifecycle, PipeWire-to-WebRTC encoding, and daemon-owned signaling and control arbitration. The current browser remembers its selected display; another browser's choice is independent.