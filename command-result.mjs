// The host keeps only kind and text. This Markdown is both the ordinary chat
// response and the source for the interactive card when the chat is reopened.
export function commandResult({title, summary, details=[], schedule, reports=[], actions=[]}, kind='success') {
  const parts = ['## ' + title, summary];
  if (details.length) parts.push(details.map(detail => '- ' + detail).join('\n'));
  if (schedule) parts.push('周报安排：每周五 ' + schedule.time + '（北京时间），' + (schedule.enabled ? '已启用。' : '已暂停。'));
  if (reports.length) parts.push('往期周报\n' + reports.map(report => '- ' + report.label + ' · `/civil-digest ' + report.id + '`').join('\n'));
  if (actions.length) parts.push('可用操作\n' + actions.map(action => action.command
    ? '- ' + action.label + ' · `' + action.command + '`'
    : '- [' + action.label + '](<' + action.href + '>)').join('\n'));
  return { kind, text: parts.join('\n\n') };
}

export const commandAction = (label, command) => ({ label, command });

export function commandError(title, error, actions=[]) {
  const summary = error instanceof Error ? error.message : String(error);
  return commandResult({title, summary, actions}, 'error');
}
