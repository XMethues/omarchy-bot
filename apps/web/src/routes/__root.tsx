import { Outlet, createRootRoute } from "@tanstack/react-router";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

export const Route = createRootRoute({
  component: () => (
    <Theme theme={neutralTheme}>
      <Outlet />
    </Theme>
  ),
});
