import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {commandAction, commandError, commandResult} from './command-result.mjs';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const iconBytes = fs.readFileSync(new URL('./icon.svg', import.meta.url));
const ICON = 'data:image/svg+xml;base64,' + iconBytes.toString('base64');
const INDEX_PATH = '/civil-ontology/market/index.json';
const MARKER = '.market-registered.json';

/** 分发源：公开 git 仓库，锁定到包含本版本的提交。改版本时同步更新 GIT_COMMIT。 */
const GIT_URL = 'https://github.com/liuranfeng/civil-ontology-plugin-dsh.git';
const GIT_COMMIT = '0956658003e3f63b156ed50e85e67e71b08e5e12';
const MARKET_VERSION = '1.0.2';
const PREVIOUS_COMMIT = '4b64477eaf9eaad30255c470326523e51cb8e759';

const TITLE = { en: 'Civil Legal Ontology', zh: '民事法律关系本体' };
const DESCRIPTION = {
  en: 'One civil-law ontology for contract review, legal advice and case research, plus a weekly confirmed write-back of facts, results, methods and trade-offs.',
  zh: '用同一份民事法律关系办理合同审查、法律咨询和类案检索，并按周把会话中的事实、成果、技能、取舍确认后写回本体。'
};

/** 格式 1 的市场索引文档：自托管在本机 Web 服务上，插件市场按索引源读取。 */
export function buildIndex({ origin }) {
  return {
    format: 1,
    title: TITLE,
    description: DESCRIPTION,
    metadata: {
      categories: { legal: { title: { en: 'Legal', zh: '法律' } } },
      labels: {
        civil: { title: { en: 'Civil law', zh: '民事' } },
        ontology: { title: { en: 'Ontology', zh: '本体' } },
        memory: { title: { en: 'Memory loop', zh: '记忆闭环' } }
      },
      sortKeys: {}
    },
    plugins: [{
      name: pkg.name,
      title: TITLE,
      description: DESCRIPTION,
      icon: ICON,
      author: '民事法律关系本体',
      metadata: { category: 'legal', keywords: ['民事', '合同审查', '法律咨询', '类案检索', '本体'], labels: ['civil', 'ontology', 'memory'], sortKeys: {} },
      versions: [{
        version: MARKET_VERSION,
        publishTimestamp: Math.floor(Date.parse('2026-11-20T08:20:00Z') / 1000),
        source: { type: 'git', url: GIT_URL, commit: GIT_COMMIT },
        engines: { dsh: '*' }
      }, {
        version: '1.0.1',
        publishTimestamp: Math.floor(Date.parse('2026-11-20T07:00:00Z') / 1000),
        source: { type: 'git', url: GIT_URL, commit: '72c41c2134b043d047d18bce8671dabeb4a1692e' },
        engines: { dsh: '*' }
      }, {
        version: '1.0.0',
        publishTimestamp: Math.floor(Date.parse('2026-11-20T00:00:00Z') / 1000),
        source: { type: 'git', url: GIT_URL, commit: '3f6c06748e7e0f36698953734766b4231f45136f' },
        engines: { dsh: '*' }
      }]
    }]
  };
}

export function registerMarket(ctx, { home, config = {} }) {
  const statusFile = path.join(home, 'memory', 'market-status.json');
  const marker = path.join(home, 'memory', MARKER);
  const state = { url: null, market: undefined, route: false };
  const note = payload => {
    try {
      fs.mkdirSync(path.dirname(statusFile), { recursive: true });
      fs.writeFileSync(statusFile, JSON.stringify({ at: new Date().toISOString(), url: state.url, route: state.route, ...payload }, null, 2));
    } catch { /* 诊断信息写入失败不影响插件 */ }
  };

  if (typeof ctx.inject !== 'function') {
    note({ ok: false, reason: '宿主未提供 inject' });
    return { ok: false, reason: '宿主未提供 inject' };
  }

  const addIndex = async market => {
    const url = state.url;
    if (!url) return { ok: false, reason: '索引地址尚未就绪' };
    const urls = market.listIndexes().map(x => x.url);
    if (urls.includes(url)) return { ok: true, url, already: true };
    await market.setIndexes([...urls, url]);
    return { ok: true, url, added: true };
  };

  const listed = async () => {
    const market = state.market;
    if (!market) return { ok: false, reason: '插件市场服务尚未就绪' };
    return addIndex(market);
  };

  // Web 服务与市场服务都可能晚于本插件挂载，因此用 inject 等待，而不是一次性 get。
  ctx.inject(['webServer'], webCtx => {
    const web = webCtx.webServer;
    const origin = web.getOrigin();
    state.url = origin + INDEX_PATH;
    const document = buildIndex({ origin });
    const route = {
      kind: 'exact',
      path: INDEX_PATH,
      handler: (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify(document));
      }
    };
    // 路由挂在本插件的 effect 上，停用插件时才会让出路径。
    try {
      if (typeof webCtx.effect === 'function') webCtx.effect(() => web.register(route));
      else web.register(route);
      state.route = true;
      note({ ok: true, url: state.url, route: true });
    } catch (error) {
      if (!/duplicate exact route/i.test(String(error?.message || error))) throw error;
      note({ ok: true, url: state.url, route: false, reason: 'route already registered' });
    }

    webCtx.inject(['pluginMarket'], marketCtx => {
      state.market = marketCtx.pluginMarket;
      if (config.marketIndex === false || fs.existsSync(marker)) return;
      addIndex(state.market).then(result => {
        note(result);
        if (result.ok) {
          fs.mkdirSync(path.dirname(marker), { recursive: true });
          fs.writeFileSync(marker, JSON.stringify({ url: state.url, at: new Date().toISOString(), pkg: pkg.name, version: pkg.version }, null, 2));
        }
      }).catch(error => note({ ok: false, url: state.url, error: String(error?.message || error), code: error?.code, kind: error?.name }));
    });
  });

  ctx.inject(['commands'], commandContext => {
    commandContext.commands.register({
      name: 'civil-market', description: '查看本体在插件市场的索引地址，并把本机索引源加回插件市场。',
      handler: async () => {
        try {
          const result = await listed();
          const summary=result.ok?(result.added?'已将本体加入本机插件市场索引。':'本体已列入本机插件市场索引。'):'插件市场尚未登记本体索引。';
          const details=['本机市场入口'+(state.route?'已就绪。':'尚未就绪。'),
            '本机版本　'+pkg.version+'。市场版本　'+MARKET_VERSION+'。',
            result.ok?'可在插件市场「发现」页搜索“民事”或“本体”。':('未能写入索引源：'+result.reason)];
          return commandResult({title:'本体插件市场',summary,details,
            actions:[commandAction('重新检查索引','/civil-market'),commandAction('本体工作台','/civil')]},result.ok?'success':'error');
        } catch (e) { return commandError('本体插件市场',e,[commandAction('重新检查索引','/civil-market')]); }
      }
    });
  });

  return { ok: true, url: state.url, digest: createHash('sha256').update(JSON.stringify(buildIndex({ origin: state.url || '' }))).digest('hex').slice(0, 12) };
}
