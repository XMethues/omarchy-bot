# 02: Decouple Bot Screen runtime lifecycle

**What to build:** Preserve the existing nested-Hyprland Bot Screen behavior while making compositor setup, output readiness, Bot Desktop readiness, application lifetime, capture/input attachment, recovery, and teardown private to one compositor-neutral Bot Screen runtime boundary. Alacritty and Hyprland-specific control must no longer define the manager's product-level lifecycle contract.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Bot Screen callers continue to provision, observe, input, recover, and stop Screens through Bot-owned lifecycle and operation results rather than compositor commands or process identifiers.
- [ ] The current nested-Hyprland implementation still reaches ready state, captures the correct output, accepts existing helper input, and tears down completely.
- [ ] The manager's readiness contract describes a private Wayland socket, configured output geometry, ready desktop surface, input helper, and computer worker without naming Hyprland, `hyprctl`, or Alacritty.
- [ ] Hyprland-specific output creation, output discovery, application checks, and cleanup remain encapsulated inside the current runtime implementation during the prefactor.
- [ ] Application exit and compositor exit are represented as distinct runtime outcomes even though the existing implementation may still treat either as fatal until the lightweight Bot Desktop lands.
- [ ] Runtime facts such as compositor type, socket names, process identifiers, and command arguments are not added to persistence or public API contracts.
- [ ] Existing Bot Screen lifecycle, restart reconciliation, stale-generation rejection, sibling failure isolation, capacity admission, and permanent deletion behavior remain green.
- [ ] No second production runtime is enabled by this ticket; it creates the single seam used by the later Cage slice.
