// Web-preview fixtures (open the web build with ?demo). Lets the layout be checked without iCloud. Never used on a device.
const now = Date.now(), H = 3600000;
export const isDemo = () => typeof location !== 'undefined' && typeof location.search === 'string' && /[?&]demo\b/.test(location.search);
export const status = { ts: now, online: true, account: 'you@gmail.com', unread: 3, ver: 1, parts: 1, handled: {} };
export const list = [
  { id: 'a', h: '1', subject: 'Lab report due Friday', from: 'Ms. Rivera <rivera@school.edu>', snippet: 'Hi all, a reminder that the Unit 4 lab report is due this Friday by 3pm. Please include your data tables.', date: now - 0.5 * H, unread: true, n: 3, flags: ['inbox'], att: true },
  { id: 'b', h: '1', subject: 'Your receipt from Apple', from: 'Apple <no_reply@email.apple.com>', snippet: 'Receipt for your recent purchase. Order ID 4F2K9.', date: now - 5 * H, unread: true, n: 1, flags: ['inbox'] },
  { id: 'c', h: '1', subject: 'Weekend plans?', from: 'Dan Cohen <dan@example.com>', snippet: 'Are we still on for Saturday? I was thinking we could grab lunch first.', date: now - 26 * H, unread: false, n: 2, flags: ['inbox', 'star'] },
  { id: 'd', h: '1', subject: 'Re: Project update', from: 'Priya <priya@example.com>', snippet: 'Sounds good, I will send the slides tonight.', date: now - 60 * H, unread: true, n: 4, flags: ['inbox'] },
  { id: 'e', h: '1', subject: 'Reading list', from: 'Me <you@gmail.com>', snippet: 'Here are the three books I mentioned.', date: now - 100 * H, unread: false, n: 1, flags: ['sent'] },
];
export const thread = (id) => {
  const s = list.find((x) => x.id === id) || list[0];
  return { id, h: s.h, subject: s.subject, msgs: [
    { id: id + '1', from: s.from, to: 'you@gmail.com', cc: '', subject: s.subject, date: s.date - 3 * H, labels: ['INBOX'], snippet: 'Thanks for the quick reply!', text: 'Thanks for the quick reply!\n\nI will take a look tonight and get back to you.', html: '', atts: [] },
    { id: id + '2', from: 'you@gmail.com', to: s.from, cc: '', subject: 'Re: ' + s.subject, date: s.date - 2 * H, labels: ['SENT'], snippet: 'Sounds good.', text: 'Sounds good.', html: '', atts: [] },
    { id: id + '3', from: s.from, to: 'you@gmail.com', cc: 'team@example.com', subject: s.subject, date: s.date, labels: ['INBOX', 'UNREAD'], snippet: s.snippet, text: s.snippet + '\n\nBest,\nThe team', html: '', atts: s.att ? [{ name: 'rubric.pdf', size: 84211, type: 'application/pdf' }] : [] },
  ] };
};
