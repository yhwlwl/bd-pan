import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "未来梦 · 成都七中科协",
  description: "全校师生在线浏览《未来梦》校刊 PDF",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
