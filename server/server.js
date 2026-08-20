// ============================================================
// CMDB 后端：Node 内置 http + node:sqlite
//   - 打开/初始化 cmdb.db（SQLite）
//   - GET /api/cmdb  返回机柜/服务器/网络设备/链路快照
//   - 生产模式下同时托管 dist/ 静态文件
// ============================================================

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { seedCmdb } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DB_PATH = process.env.CMDB_DB || path.join(ROOT, 'cmdb.db');
const PORT = Number(process.env.PORT || 8787);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
seedCmdb(db);

function getCmdb() {
  const rows = db
    .prepare('SELECT id, name, letter FROM rows ORDER BY id')
    .all();
  const racks = db
    .prepare(
      'SELECT id, name, row_id AS rowId, position, u_height AS uHeight, model, status FROM racks ORDER BY row_id, position'
    )
    .all();
  const servers = db
    .prepare(
      'SELECT id, name, rack_id AS rackId, u_start AS uStart, u_height AS uHeight, ip, mgmt_ip AS mgmtIp, model, business, status FROM servers ORDER BY rack_id, u_start'
    )
    .all();
  const devices = db
    .prepare(
      'SELECT id, name, type, rack_id AS rackId, ip, mgmt_ip AS mgmtIp, model, business, status FROM devices ORDER BY type, id'
    )
    .all();
  const links = db
    .prepare('SELECT id, plane, a_id AS aId, b_id AS bId, status FROM links ORDER BY id')
    .all();

  return { rows, racks, servers, devices, links };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

async function serveStatic(res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(DIST, rel));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    // SPA 回退到 index.html
    try {
      const data = await readFile(path.join(DIST, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not Found');
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/cmdb') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(getCmdb()));
    return;
  }

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (existsSync(DIST)) {
    await serveStatic(res, url.pathname);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('前端未构建：请先运行 npm run build（开发模式请用 npm run dev）');
  }
});

server.listen(PORT, () => {
  console.log(`[cmdb] SQLite: ${DB_PATH}`);
  console.log(`[cmdb] API:    http://localhost:${PORT}/api/cmdb`);
  if (existsSync(DIST)) {
    console.log(`[cmdb] Web:    http://localhost:${PORT}/`);
  }
});
