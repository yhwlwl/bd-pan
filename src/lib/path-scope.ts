/** Error raised when a browser-supplied path cannot be used safely. */
export class AlistPathScopeError extends Error {
    readonly code = 'ALIST_PATH_SCOPE_DENIED';

    constructor(message: string) {
        super(message);
        this.name = 'AlistPathScopeError';
    }
}

export function isAlistPathScopeError(error: unknown): error is AlistPathScopeError {
    return Boolean(error && typeof error === 'object'
        && (error as { code?: unknown }).code === 'ALIST_PATH_SCOPE_DENIED');
}

/**
 * AList 路径规范化与站点范围限制。
 *
 * 浏览器传入的路径只代表当前用户可见路径，不能成为 AList 的绝对路径权限。
 * 如果配置了 FORCE_BASE_PATH，所有请求都会被限制在该目录内；BD-PAN 未配置
 * 时仍保持原来的根目录行为，但会统一拒绝 ..、反斜杠和多重编码穿越。
 */
export function normalizeAlistPath(input?: string | null): string {
    const raw = (input || '/').trim();
    // AList paths are POSIX-style. Do not silently turn a browser-supplied
    // backslash into a separator: reject it so traversal probes are visible
    // to the risk-control pipeline instead of being normalized away.
    if (raw.includes('\\')) throw new AlistPathScopeError('非法路径');
    const segments: string[] = [];

    for (const segment of raw.split('/')) {
        if (!segment || segment === '.') continue;

        let decoded = segment;
        for (let pass = 0; pass < 5; pass++) {
            try {
                const next = decodeURIComponent(decoded);
                if (next === decoded) break;
                decoded = next;
            } catch {
                throw new AlistPathScopeError('非法路径编码');
            }
        }

        if (/%[0-9a-f]{2}/i.test(decoded)) throw new AlistPathScopeError('路径编码层数过多');
        if (decoded === '..' || decoded.includes('/') || decoded.includes('\\') || /[\0-\x1f\x7f]/.test(decoded)) {
            throw new AlistPathScopeError('非法路径');
        }
        if (decoded === '.') continue;
        segments.push(decoded);
    }

    return segments.length ? `/${segments.join('/')}` : '/';
}

export function normalizeAlistName(input?: string | null): string {
    const normalized = normalizeAlistPath(`/${input || ''}`);
    const name = normalized.slice(1);
    if (!name || name.includes('/')) throw new AlistPathScopeError('非法文件名');
    return name;
}

export function encodeAlistPathForUrl(input: string): string {
    return normalizeAlistPath(input).split('/').map(encodeURIComponent).join('/');
}

function joinPaths(base: string, child: string): string {
    if (base === '/') return normalizeAlistPath(child);
    if (child === '/') return base;
    return normalizeAlistPath(`${base}/${child.replace(/^\/+/, '')}`);
}

function relativeUserBase(userBase: string, forcedRoot: string): string {
    if (forcedRoot !== '/' && (userBase === forcedRoot || userBase.startsWith(`${forcedRoot}/`))) {
        return normalizeAlistPath(userBase.slice(forcedRoot.length) || '/');
    }
    return userBase;
}

export function resolveScopedAlistPath(
    input: string | undefined | null,
    userBasePath?: string,
    forceBasePath = process.env.FORCE_BASE_PATH || process.env.NEXT_PUBLIC_FORCE_BASE_PATH || '',
): string {
    const requested = normalizeAlistPath(input);
    const forcedRoot = normalizeAlistPath(forceBasePath || '/');
    const userBase = relativeUserBase(normalizeAlistPath(userBasePath || '/'), forcedRoot);

    let relative = requested;
    if (forcedRoot !== '/' && (requested === forcedRoot || requested.startsWith(`${forcedRoot}/`))) {
        relative = normalizeAlistPath(requested.slice(forcedRoot.length) || '/');
    }

    const userScoped = userBase === '/'
        ? relative
        : (relative === userBase || relative.startsWith(`${userBase}/`))
            ? relative
            : joinPaths(userBase, relative);

    const absolute = forcedRoot === '/' ? userScoped : joinPaths(forcedRoot, userScoped);
    if (forcedRoot !== '/' && absolute !== forcedRoot && !absolute.startsWith(`${forcedRoot}/`)) {
        throw new AlistPathScopeError('路径超出允许范围');
    }
    return absolute;
}

export function stripScopedAlistPath(
    input: string,
    userBasePath?: string,
    forceBasePath = process.env.FORCE_BASE_PATH || process.env.NEXT_PUBLIC_FORCE_BASE_PATH || '',
): string {
    let value = normalizeAlistPath(input);
    const forcedRoot = normalizeAlistPath(forceBasePath || '/');
    const userBase = relativeUserBase(normalizeAlistPath(userBasePath || '/'), forcedRoot);

    if (forcedRoot !== '/' && (value === forcedRoot || value.startsWith(`${forcedRoot}/`))) {
        value = normalizeAlistPath(value.slice(forcedRoot.length) || '/');
    }
    if (userBase !== '/' && (value === userBase || value.startsWith(`${userBase}/`))) {
        value = normalizeAlistPath(value.slice(userBase.length) || '/');
    }
    return value;
}

export function getAlistPermissionPathVariants(
    input: string,
    userBasePath?: string,
    forceBasePath = process.env.FORCE_BASE_PATH || process.env.NEXT_PUBLIC_FORCE_BASE_PATH || '',
): string[] {
    const value = normalizeAlistPath(input);
    const variants = new Set<string>([value]);
    if (!forceBasePath.trim()) return [...variants];

    const forcedRoot = normalizeAlistPath(forceBasePath || '/');
    let relativeToForce = value;
    if (forcedRoot !== '/' && (value === forcedRoot || value.startsWith(`${forcedRoot}/`))) {
        relativeToForce = normalizeAlistPath(value.slice(forcedRoot.length) || '/');
        variants.add(relativeToForce);
    }

    const userBase = relativeUserBase(normalizeAlistPath(userBasePath || '/'), forcedRoot);
    if (userBase !== '/' && (relativeToForce === userBase || relativeToForce.startsWith(`${userBase}/`))) {
        variants.add(normalizeAlistPath(relativeToForce.slice(userBase.length) || '/'));
    }
    return [...variants];
}
