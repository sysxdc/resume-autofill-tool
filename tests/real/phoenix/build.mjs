/**
 * 打包北森 Phoenix 组件：tests/real/vendor/phoenix.bundle.js + phoenix.css
 * （包本身是带 core-js / babel runtime 的 ESM，浏览器不能直接加载；React 用页面上的 UMD 全局）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REAL = path.dirname(HERE);
const require = createRequire(path.join(REAL, 'package.json'));
const esbuild = require('esbuild');
const out = path.join(REAL, 'vendor');
fs.mkdirSync(out, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(HERE, 'entry.js')],
  bundle: true,
  format: 'iife',
  outfile: path.join(out, 'phoenix.bundle.js'),
  loader: { '.js': 'jsx', '.css': 'empty', '.scss': 'empty' },
  alias: {
    util: path.join(HERE, 'util-shim.js'),
    react: path.join(HERE, 'react-shim.js'),
    'react-dom': path.join(HERE, 'react-dom-shim.js')
  },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'error',
  absWorkingDir: REAL,
  nodePaths: [path.join(REAL, 'node_modules')]
});
const css = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'cjs' && f !== 'node_modules') walk(p); }
    else if (f.endsWith('.css') && p.includes(path.sep + 'lib' + path.sep)) css.push(fs.readFileSync(p, 'utf8'));
  }
})(path.join(REAL, 'node_modules', '@beisen-phoenix'));
fs.writeFileSync(path.join(out, 'phoenix.css'), css.join('\n'));
console.log('phoenix bundle ok:', fs.statSync(path.join(out, 'phoenix.bundle.js')).size, 'bytes,', css.length, 'css files');
void execFileSync;
