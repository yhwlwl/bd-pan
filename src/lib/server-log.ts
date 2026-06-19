// 服务端内存日志缓存 — 可在管理面板查看

const MAX = 500;
const buffer: Array<{ time: string; level: string; msg: string }> = [];

const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;

function fmt(args: any[]): string {
    return args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
}

console.log = (...args: any[]) => {
    buffer.push({ time: new Date().toISOString(), level: 'log', msg: fmt(args) });
    if (buffer.length > MAX) buffer.shift();
    origLog.apply(console, args);
};

console.warn = (...args: any[]) => {
    buffer.push({ time: new Date().toISOString(), level: 'warn', msg: fmt(args) });
    if (buffer.length > MAX) buffer.shift();
    origWarn.apply(console, args);
};

console.error = (...args: any[]) => {
    buffer.push({ time: new Date().toISOString(), level: 'error', msg: fmt(args) });
    if (buffer.length > MAX) buffer.shift();
    origError.apply(console, args);
};

export function getRecentLogs(limit = 100) {
    return buffer.slice(-limit).reverse();
}
