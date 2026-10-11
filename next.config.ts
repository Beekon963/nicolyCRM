import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // AI アシスタントが使い方の案内に使う操作マニュアルを、サーバーの関数に含める
  outputFileTracingIncludes: {
    "/api/ai": ["./docs/manual_admin.md"],
  },
};

export default nextConfig;
