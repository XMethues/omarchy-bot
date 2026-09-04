import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/rollup-plugin";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig(({ command }) => ({
  plugins: [
    tanstackRouter({ target: "react", routesDirectory: "src/routes", generatedRouteTree: "src/routeTree.gen.ts" }),
    react(),
    stylex({ dev: command === "development", unstable_moduleResolution: { type: "commonJS" } }),
    {
      name: "stylex-stylesheet",
      transformIndexHtml: {
        order: "post",
        handler: () => [{ tag: "link", attrs: { rel: "stylesheet", href: "/stylex.css" }, injectTo: "head" }],
      },
    },
  ],
  server: {
    host: process.env.OMARCHY_BOT_HOST ?? "127.0.0.1",
    port: 7322,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7321",
        ws: true,
      },
    },
  },
}));
