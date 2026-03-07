import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "成都七中STA · 科协网盘",
  description: "成七科协 — 百度网盘文件共享平台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh" suppressHydrationWarning>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
