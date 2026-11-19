// Small helpers: sender parsing, dates, quoting for replies, ids.
export function parseAddr(s = '') {
  const m = String(s).match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2], email: m[2].trim() };
  return { name: String(s).trim(), email: String(s).trim() };
}
export const senderName = (s) => parseAddr(s).name.replace(/^"|"$/g, '') || '(unknown)';
export const initial = (s) => { const n = senderName(s).replace(/[^\p{L}\p{N} ]/gu, '').trim(); return (n[0] || '?').toUpperCase(); };

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const t12 = (d) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
/** Mail-style list date: time today, "Yesterday", weekday this week, else short date. */
export function listDate(ms) {
  if (!ms) return '';
  const d = new Date(ms), n = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 86400000);
  if (diff === 0) return t12(d);
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return DAYS[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}
export const fullDate = (ms) => { const d = new Date(ms); return `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${t12(d)}`; };

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const rePrefix = (s = '') => (/^re:/i.test(s) ? s : 'Re: ' + s);
export const fwdPrefix = (s = '') => (/^fwd?:/i.test(s) ? s : 'Fwd: ' + s);
export function quoteFor(m) {
  const body = (m.text || '').split('\n').map((l) => '> ' + l).join('\n');
  return `\n\nOn ${fullDate(m.date)}, ${senderName(m.from)} <${parseAddr(m.from).email}> wrote:\n${body}`;
}
export const validEmails = (s) => String(s || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
export const looksEmail = (x) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(parseAddr(x).email);
