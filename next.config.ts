import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  transpilePackages: [
    "@tauri-apps/api",
    "@tauri-apps/plugin-shell",
    "@tauri-apps/plugin-dialog",
    "@tauri-apps/plugin-log"
  ],
};

export default nextConfig;
