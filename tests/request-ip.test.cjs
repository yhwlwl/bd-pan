const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const filename = path.resolve(__dirname, '../src/lib/request-ip.ts');
const mod = new Module(filename, module);
mod.filename = filename;
mod.paths = module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { resolveRequestIp } = mod.exports;
const vercel = { vercel: true, production: true };
const ecs = { vercel: false, production: true };

test('Vercel uses platform supplied address and ignores incompatible origin header', () => {
  assert.equal(resolveRequestIp(new Headers({
    'x-vercel-forwarded-for': '192.0.2.10',
    'x-wlm-client-ip': '192.0.2.20',
  }), vercel), '192.0.2.10');
  assert.equal(resolveRequestIp(new Headers({'x-forwarded-for': '192.0.2.11'}), vercel), '192.0.2.11');
});
test('Vercel missing or ambiguous address stays unknown', () => {
  assert.equal(resolveRequestIp(new Headers({'x-wlm-client-ip': '192.0.2.20'}), vercel), 'unknown');
  assert.equal(resolveRequestIp(new Headers({'x-vercel-forwarded-for': '192.0.2.10, 192.0.2.20'}), vercel), 'unknown');
});
test('ECS preserves trusted proxy handling and ignores other headers in production', () => {
  assert.equal(resolveRequestIp(new Headers({'x-wlm-client-ip': '192.0.2.20'}), ecs), '192.0.2.20');
  assert.equal(resolveRequestIp(new Headers({'x-forwarded-for': '192.0.2.11', 'x-vercel-forwarded-for': '192.0.2.12'}), ecs), 'unknown');
});
test('IPv6 and IPv4-mapped addresses keep valid risk keys', () => {
  assert.equal(resolveRequestIp(new Headers({'x-vercel-forwarded-for': '2001:db8::1'}), vercel), '2001:db8::1');
  assert.equal(resolveRequestIp(new Headers({'x-wlm-client-ip': '::ffff:192.0.2.10'}), ecs), '192.0.2.10');
});
test('UTF-8 risk warning is safe in response header and round trips', () => {
  const warning = '⚠️ 风险提醒';
  const h = new Headers({'X-Risk-Warning': encodeURIComponent(warning)});
  assert.equal(decodeURIComponent(h.get('X-Risk-Warning')), warning);
});
