import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerMarket, buildIndex } from './market-index.mjs';

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'civil-market-'));

function fakeHost({ duplicateRoute = false } = {}) {
  const routes = new Map(), indexes = [], effects = [];
  const webServer = {
    getOrigin: () => 'http://127.0.0.1:3080',
    register(route) {
      if (routes.has(route.path) || duplicateRoute) throw Error('webserver: duplicate exact route "' + route.path + '"');
      routes.set(route.path, route);
      return () => routes.delete(route.path);
    }
  };
  const pluginMarket = {
    listIndexes: () => indexes.map(url => ({ url })),
    setIndexes: async urls => { indexes.splice(0, indexes.length, ...urls); }
  };
  const services = { webServer, pluginMarket };
  const ctx = {
    effect(fn) { const dispose = fn(); effects.push(dispose); return dispose; },
    inject(deps, callback) {
      const missing = deps.filter(name => !services[name]);
      if (missing.length) return undefined;
      const child = { ...ctx, ...Object.fromEntries(deps.map(name => [name, services[name]])) };
      callback(child);
      return child;
    },
    get(name) { return services[name]; }
  };
  const subscribers = [];
  ctx.inject = (deps, callback) => {
    // 模拟服务晚挂载：先把回调存起来，由测试决定何时触发。
    subscribers.push({ deps, callback });
    return undefined;
  };
  const flush = () => {
    let pending = subscribers.splice(0, subscribers.length);
    while (pending.length) {
      const { deps, callback } = pending.shift();
      if (deps.some(name => !services[name])) continue;
      const child = { ...ctx, ...Object.fromEntries(deps.map(name => [name, services[name]])) };
      callback(child);
      pending = pending.concat(subscribers.splice(0, subscribers.length));
    }
  };
  return { ctx, routes, indexes, flush, effects };
}

test('Web 服务晚于插件挂载时，索引路由与市场源都在服务就绪后完成', async () => {
  const root = home();
  const host = fakeHost();
  const result = registerMarket(host.ctx, { home: root });
  assert.equal(result.url, null, '服务未就绪时不应假装成功');
  assert.equal(host.routes.size, 0);

  host.flush();
  await new Promise(resolve => setImmediate(resolve));

  const route = host.routes.get('/civil-ontology/market/index.json');
  assert.ok(route, '索引路由应已注册');
  assert.deepEqual(host.indexes, ['http://127.0.0.1:3080/civil-ontology/market/index.json']);
  assert.ok(fs.existsSync(path.join(root, 'memory', '.market-registered.json')));

  let body = '';
  route.handler({}, { writeHead() {}, end(text) { body = text; } });
  const index = JSON.parse(body);
  assert.equal(index.format, 1);
  assert.equal(index.plugins[0].name, 'civil-ontology-dsh');
  assert.equal(index.plugins[0].versions[0].source.type, 'git');
  assert.match(index.plugins[0].versions[0].source.commit, /^[0-9a-f]{40}$/);

  const status = JSON.parse(fs.readFileSync(path.join(root, 'memory', 'market-status.json'), 'utf8'));
  assert.equal(status.ok, true);
  assert.equal(status.route, true);
});

test('路由已被占用时不阻断插件启用，且不重复写入市场源', async () => {
  const root = home();
  const host = fakeHost({ duplicateRoute: true });
  assert.doesNotThrow(() => { registerMarket(host.ctx, { home: root }); host.flush(); });
  const status = JSON.parse(fs.readFileSync(path.join(root, 'memory', 'market-status.json'), 'utf8'));
  assert.equal(status.route, false);
  assert.equal(host.routes.size, 0);
});

test('索引文档包含四类标签与固定发布提交', () => {
  const index = buildIndex({ origin: 'http://127.0.0.1:3080' });
  assert.equal(index.metadata.categories.legal.title.zh, '法律');
  assert.deepEqual(index.plugins[0].metadata.labels, ['civil', 'ontology', 'memory']);
  assert.match(index.plugins[0].versions[0].source.url, /^https:\/\/github\.com\/liuranfeng\/civil-ontology-plugin-dsh\.git$/);
});
