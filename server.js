#!/usr/bin/env node
// PowerFedora50 入口：node server.js（模拟数据：POWERFEDORA_MOCK=1 node server.js）
const path = require('path');
const fs = require('fs');
const { build, createServer } = require('./src/app');
const { Store } = require('./src/store');
const em = require('./src/em');
const tencent = require('./src/tencent');
const fallback = require('./src/fallback');
const mock = require('./src/mock');
const cls = require('./src/cls');

const PORT = Number(process.env.PORT) || 5050;
const HOST = process.env.HOST || '127.0.0.1'; // 没有登录功能，默认只允许本机访问
const DATA = process.env.POWERFEDORA_DATA || path.join(__dirname, 'data');
const useMock = process.env.POWERFEDORA_MOCK === '1';
const DEFAULT_DATA = path.join(__dirname, 'data');
const sectorFallbackStore = !useMock && path.resolve(DATA) !== path.resolve(DEFAULT_DATA) && fs.existsSync(path.join(DEFAULT_DATA, 'sectors', 'cache.json'))
  ? new Store(DEFAULT_DATA) : null;

const ctx = build({
  dataDir: useMock ? path.join(DATA, 'mock') : DATA,
  provider: useMock
    ? (pool) => mock.create({ names: Object.fromEntries(pool.list().map((p) => [p.code, p.name])) })
    : fallback.create(em, tencent), // 东方财富失败时沪深行情/日线自动切腾讯
  hotspotSource: useMock ? null : cls,
  sectorFallbackStore
});
const server = createServer(ctx);

server.listen(PORT, HOST, () => {
  console.log(`PowerFedora50 已启动：http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}${useMock ? '　（模拟数据）' : ''}`);
  console.log(`股池 ${ctx.pool.items.length} 只，数据目录 ${useMock ? path.join(DATA, 'mock') : DATA}`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') console.warn('注意：系统没有登录保护，不要把它暴露到公网。');
  ctx.scheduler.start();
});

const quit = () => { ctx.scheduler.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
