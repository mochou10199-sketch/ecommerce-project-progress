import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const ogImage = `${protocol}://${host}/og.png`;

  return {
    title: {
      default: "电商项目进度助手",
      template: "%s · 电商项目进度助手",
    },
    description: "基于可验证项目资料的电商项目进度查询与 AI 问答工具。",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "电商项目进度助手",
      description: "快速查询项目状态、风险、负责人和资料来源。",
      images: [{ url: ogImage, width: 1688, height: 938 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "电商项目进度助手",
      description: "快速查询项目状态、风险、负责人和资料来源。",
      images: [ogImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
