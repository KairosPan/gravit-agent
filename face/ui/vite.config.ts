import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

/** Preload only the Manrope latin slice. The built CSS already points at that file; the tag uses the same hashed URL. */
function preloadManropeLatin(): Plugin {
  const marker = "manrope-latin-wght-normal";
  return {
    name: "preload-manrope-latin",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;
        const asset = Object.values(bundle).find(
          (item) => item.type === "asset" && item.fileName.includes(marker),
        );
        if (!asset || asset.type !== "asset") return html;
        const href = `/${asset.fileName}`;
        const tag = `<link rel="preload" href="${href}" as="font" type="font/woff2" crossorigin="anonymous" />`;
        return html.replace("</head>", `    ${tag}\n  </head>`);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), preloadManropeLatin()],
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
    },
  },
  server: { host: "127.0.0.1", port: 5190, strictPort: true },
  preview: { host: "127.0.0.1", port: 5190, strictPort: true },
});
