/**
 * 民事法律关系本体 · 右侧边栏页签
 *
 * 在 dsh-better-sidebar 里注册一个“本体”页签，把已有的只读页面装进右侧边栏：
 *   /civil-ontology/atlas    关系图与请求权依据
 *   /civil-ontology/weekly   本期周报画布
 * 同时声明 urlTarget：从会话里点这些链接时，不再整页跳转，而是在侧边栏页签中打开。
 */
window.__ModuleLoader__.load({
  id: 'civil-ontology-dsh',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react');

    const DEFAULT_SRC = '/civil-ontology/atlas';
    const CLAIMS = [/^\/civil-ontology\/atlas\/?$/, /^\/civil-ontology\/weekly(\/|$)/];

    function sourceOf(tab) {
      const path = tab && tab.path;
      return typeof path === 'string' && path ? path : DEFAULT_SRC;
    }

    function CivilOntologyTab(props) {
      const src = sourceOf(props && props.tab);
      return React.createElement('iframe', {
        key: src,
        src,
        title: '民事法律关系本体',
        referrerPolicy: 'no-referrer',
        style: { display: 'block', width: '100%', height: '100%', border: '0', background: '#fff' }
      });
    }

    function claims(url) {
      return Boolean(url) && CLAIMS.some(re => re.test(url.pathname));
    }

    function apply(ctx) {
      ctx.effect(() => ctx.betterSidebar.registerTab({
        id: 'civil-ontology:atlas',
        title: '本体',
        description: '民事法律关系图、请求权依据与本期周报画布',
        order: 35,
        component: CivilOntologyTab,
        dedupeKey: tab => (tab && tab.path) || DEFAULT_SRC,
        urlTarget: claims
      }), 'civil-ontology: sidebar ontology tab');
    }

    exports.apply = apply;
    exports.inject = ['betterSidebar'];
    return module.exports;
  }
});
