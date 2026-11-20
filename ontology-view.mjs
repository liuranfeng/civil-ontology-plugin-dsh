import {readFileSync} from 'node:fs';
import {verifyMethodSnapshot} from './approved-methods.mjs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const data = name => JSON.parse(read('./civil/' + name + '.json'));
const ui = name => read('./ontology-ui/' + name);

export function ontologyData() {
  const model = data('model');
  const types = new Set(model.types);
  if (model.relations.some(([from, phrase, to]) => !types.has(from) || !types.has(to) || !phrase))
    throw Error('本体中有尚未登记的关系或对象。');
  const methods = verifyMethodSnapshot(readFileSync(new URL('./civil/approved-methods.json', import.meta.url)));
  const company = data('company');
  return {
    model, methods, statutes: data('code'),
    approval: data('method-approval'),
    enterprise: {
      scope: company.scope,
      families: company.families,
      cards: company.cards.map(({title, groups, source, location, status, fields, section}) =>
        ({title, groups, source, location, status, fields, section})),
      conflicts: company.conflicts.map(({title, disposition, topics}) => ({title, disposition, topics}))
    }
  };
}

// The only input to the interface is the verified knowledge shipped with this package.
export function renderOntology(caseExperience) {
  const catalog = ontologyData();
  if (Array.isArray(caseExperience)) {
    catalog.experience = caseExperience.map(row => ({
      title: row.title, scope: row.scope, change: row.relation, kind: row.type,
      sources: (row.evidenceView?.sources || []).map(s => ({role:s.role,title:s.title}))
    }));
  }
  const payload = JSON.stringify(catalog).replace(/</g, '\\u003c');
  return ui('page.html').replace('/*CSS*/', () => ui('style.css'))
    .replace('/*DATA*/', () => payload).replace('/*APP*/', () => ui('app.js'));
}
