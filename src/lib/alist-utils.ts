// AList 通用工具 — 递归列文件

function normalizeVisiblePath(path: string): string {
    return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

export async function getAllFilesInDir(
    aListUrl: string,
    aListToken: string,
    dirPath: string,
    maxDepth = 100,
): Promise<Array<{ path: string; size: number; name: string; sign?: string }>> {
    // 快速路径：尝试 alist search（scope=1 递归搜索，一次替代 N 次 BFS）
    try {
        const searchRes = await fetch(`${aListUrl}/api/fs/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: aListToken },
            body: JSON.stringify({ keywords: '', parent: dirPath, scope: 1, page: 1, per_page: 99999 }),
        });
        const searchData = await searchRes.json();
        if (searchData.code === 200 && Array.isArray(searchData.data?.content) && searchData.data.content.length > 0) {
            const result: Array<{ path: string; size: number; name: string; sign?: string }> = [];
            for (const item of searchData.data.content) {
                if (item.is_dir) continue; // search 返回目录和文件，只取文件
                const path = item.path || item?.obj_path || item?.full_path
                    || (item.parent && item.name ? `${String(item.parent).replace(/\/+$/, '')}/${item.name}` : '') || '';
                if (!path) continue;
                result.push({ path, size: item.size || 0, name: item.name || path.split('/').pop() || '', sign: item.sign || undefined });
            }
            if (result.length > 0) return result;
        }
    } catch { /* 降级到 BFS */ }

    // 降级路径：BFS 遍历（3 并发处理子目录）
    const allFiles: Array<{ path: string; size: number; name: string; sign?: string }> = [];

    async function bfs(currentPath: string, depth: number) {
        if (depth >= maxDepth) return;
        const res = await fetch(`${aListUrl}/api/fs/list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: aListToken },
            body: JSON.stringify({ path: currentPath }),
        });
        const data = await res.json();
        if (data.code !== 200) return;
        const items = data.data?.content || [];
        const subDirs: string[] = [];

        for (const item of items) {
            const itemPath = `${normalizeVisiblePath(currentPath)}/${item.name}`.replace(/\/+/g, '/');
            if (item.is_dir) {
                subDirs.push(itemPath);
            } else {
                allFiles.push({ path: itemPath, size: item.size || 0, name: item.name, sign: item.sign || undefined });
            }
        }
        // 3 并发处理子目录
        for (let i = 0; i < subDirs.length; i += 3) {
            await Promise.all(subDirs.slice(i, i + 3).map(d => bfs(d, depth + 1)));
        }
    }

    await bfs(dirPath, 0);
    return allFiles;
}
