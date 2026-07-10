"use client";
import { useState, useEffect, useCallback } from "react";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "https://pan.tantantan.tech/pan").replace(/\/+$/, "");

interface PdfVolume {
  name: string;
  path: string;
  size?: number;
  modified?: string;
}

function extractVolNumber(name: string): number {
  const m = name.match(/Vol\.?\s*(\d+)/i) || name.match(/第(\d+)期/);
  return m ? parseInt(m[1], 10) : 99;
}

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${bytes}B`;
}

export default function Home() {
  const [volumes, setVolumes] = useState<PdfVolume[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [selectedPdf, setSelectedPdf] = useState<{ name: string; url: string } | null>(null);
  const [sessionId] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("WLM_SESSION") || crypto.randomUUID() : ""
  );

  // 持久化 sessionId
  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem("WLM_SESSION")) {
      localStorage.setItem("WLM_SESSION", sessionId);
    }
  }, [sessionId]);

  // 记录操作日志
  const logAction = useCallback(
    (actionType: string, actionItem: string) => {
      fetch(`${API_BASE}/api/log-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "访客",
          action_type: actionType,
          action_item: actionItem,
          source: "weilaimeng",
          session_id: sessionId,
        }),
      }).catch(() => {});
    },
    [sessionId]
  );

  // 访客追踪
  useEffect(() => {
    fetch(`${API_BASE}/api/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "访客",
        time: new Date().toISOString(),
        source: "weilaimeng",
        device: navigator.userAgent,
        session_id: sessionId,
      }),
    }).catch(() => {});
  }, [sessionId]);

  // 未来梦 PDF 目录（已知固定路径）
  const FOLDER_PATH = "/sta/新媒体素材/可复用文件收集/未来梦扫描件/";

  // 初始化：guest 登录 → 列文件
  const init = useCallback(async () => {
    try {
      // 1. Guest 登录
      const loginRes = await fetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guest: true }),
      });
      if (!loginRes.ok) {
        const data = await loginRes.json().catch(() => ({}));
        setError(data.error || `登录失败 (${loginRes.status})`);
        setLoading(false);
        return;
      }
      const loginData = await loginRes.json();
      const t = loginData.token;
      setToken(t);

      // 2. 列出未来梦目录
      const listRes = await fetch(`${API_BASE}/api/alist`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({
          action: "list",
          path: FOLDER_PATH,
        }),
      });
      const listData = await listRes.json();
      if (listData.code !== 200 || !listData.data?.content) {
        setError(listData.message || "获取文件列表失败");
        setLoading(false);
        return;
      }

      // 3. 筛选 PDF，构造完整路径，排序
      const files: PdfVolume[] = listData.data.content
        .filter((f: any) => !f.is_dir && f.name.toLowerCase().endsWith(".pdf"))
        .map((f: any) => ({
          name: f.name,
          path: `${FOLDER_PATH}${f.name}`,
          size: f.size,
          modified: f.modified,
        }))
        .sort((a: PdfVolume, b: PdfVolume) => extractVolNumber(a.name) - extractVolNumber(b.name));

      setVolumes(files);
      logAction("浏览 - 杂志列表", `${files.length} 期`);
      setLoading(false);
    } catch (err: any) {
      setError(err?.message || "网络异常");
      setLoading(false);
    }
  }, [logAction]);

  useEffect(() => {
    init();
  }, [init]);

  // 打开 PDF 预览
  const openPdf = useCallback(
    async (vol: PdfVolume) => {
      logAction("杂志预览", vol.name);

      // 构建预览 URL：通过 alist-download?preview=1 获取 inline 流
      const downloadUrl = `${API_BASE}/api/alist-download?path=${encodeURIComponent(vol.path)}&preview=1&token=${token}`;
      // viewer.html 由主站 ECS 的 /pan/pdfjs/ 提供
      const viewerUrl = `https://pan.tantantan.tech/pan/pdfjs/viewer.html?file=${encodeURIComponent(downloadUrl)}`;

      setSelectedPdf({ name: vol.name, url: viewerUrl });
    },
    [token, logAction]
  );

  const closePdf = useCallback(() => {
    setSelectedPdf(null);
  }, []);

  // ESC 键关闭预览
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePdf();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closePdf]);

  // ============ 渲染 ============

  // 加载中
  if (loading) {
    return (
      <div className="loading-state">
        <div className="spinner" />
        <p>加载中…</p>
      </div>
    );
  }

  // 错误
  if (error) {
    return (
      <div className="error-state">
        <h2>加载失败</h2>
        <p>{error}</p>
        <p style={{ marginTop: 16, fontSize: 12, color: "var(--text-muted)" }}>
          请确认已连接到校园网，或联系 STA 技术人员
        </p>
      </div>
    );
  }

  return (
    <>
      {/* 顶部标题 */}
      <header className="header">
        <h1>
          未来梦<span className="accent">.</span>PDF
        </h1>
        <p>成都七中科协  ·  全校师生在线预览  ·  仅限校内使用</p>
      </header>

      {/* 杂志封面网格 */}
      <main className="grid-container">
        {volumes.map((vol) => (
          <button
            key={vol.name}
            className="magazine-card"
            onClick={() => openPdf(vol)}
            aria-label={`预览 ${vol.name}`}
          >
            <div className="cover-placeholder">
              <span className="vol-number">{extractVolNumber(vol.name)}</span>
              <span className="vol-label">未来梦</span>
            </div>
            <div className="card-info">
              <span className="vol-title" title={vol.name}>
                {vol.name.replace(/\.pdf$/i, "")}
              </span>
              {vol.size != null && <span className="vol-size">{formatBytes(vol.size)}</span>}
            </div>
          </button>
        ))}

        {volumes.length === 0 && (
          <p style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--text-muted)", padding: 60 }}>
            暂无杂志数据
          </p>
        )}
      </main>

      {/* PDF 全屏预览覆盖层 */}
      {selectedPdf && (
        <div className="pdf-overlay">
          <div className="pdf-toolbar">
            <span className="pdf-title">{selectedPdf.name.replace(/\.pdf$/i, "")}</span>
            <button className="btn-close" onClick={closePdf} aria-label="关闭预览">
              ✕
            </button>
          </div>
          <iframe
            src={selectedPdf.url}
            title={selectedPdf.name}
            allow="fullscreen"
          />
          <div className="pdf-hint">仅供校内预览 · ESC 退出</div>
        </div>
      )}
    </>
  );
}
