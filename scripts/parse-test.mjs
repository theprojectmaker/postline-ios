// Offline checks of the Gmail <-> record conversion (no network): node scripts/parse-test.mjs
import { parseThread, buildRaw, htmlToText } from '../bridge/gmail.mjs';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const b64 = (s) => Buffer.from(s).toString('base64url');
const msg = (id, labels, from, text, html, date) => ({ id, labelIds: labels, internalDate: String(date), snippet: text.slice(0, 40),
  payload: { headers: [{ name: 'From', value: from }, { name: 'To', value: 'me@gmail.com' }, { name: 'Subject', value: 'Grüße ✓' }, { name: 'Message-ID', value: `<${id}@x>` }],
    mimeType: 'multipart/alternative', parts: [
      ...(text ? [{ mimeType: 'text/plain', body: { data: b64(text) } }] : []),
      ...(html ? [{ mimeType: 'text/html', body: { data: b64(html) } }] : []),
      { mimeType: 'application/pdf', filename: 'a.pdf', body: { attachmentId: 'x', size: 2048 } }] } });
const t = { id: 'T', historyId: '99', messages: [
  msg('1', ['INBOX', 'UNREAD'], 'Ann <ann@x.com>', 'Hello Ünï', '', 1000),
  msg('2', ['SENT'], 'me@gmail.com', 'Reply', '', 2000),
  msg('3', ['INBOX'], 'Ann <ann@x.com>', '', '<div>Hi&nbsp;<b>there</b> &amp; bye<br>line2</div><style>x{}</style>', 3000)] };
const { summary, detail } = parseThread(t);
ok(summary.n === 3 && summary.unread && summary.flags.includes('inbox') && summary.flags.includes('sent'), 'summary flags/unread/count');
ok(summary.from.includes('Ann') && summary.att, 'list shows other party; attachment flag');
ok(detail.msgs[0].text === 'Hello Ünï' && detail.msgs[2].text === 'Hi there & bye\nline2', 'text/plain + html fallback decode: ' + JSON.stringify(detail.msgs[2].text));
ok(detail.msgs[2].html.includes('<b>'), 'html kept for formatted view');
ok(htmlToText('<p>a</p><p>&#8217;&unknown;</p>') === 'a\n’&unknown;', 'entities');
const raw = Buffer.from(buildRaw({ to: 'a@b.com', cc: 'c@d.com', subject: 'Grüße ✓', body: 'Zeile ü\nzwei', inReplyTo: '<1@x>', references: '<0@x>' }), 'base64url').toString('utf8');
ok(/^To: a@b.com\r\nCc: c@d.com\r\nSubject: =\?UTF-8\?B\?/.test(raw) && /In-Reply-To: <1@x>\r\nReferences: <0@x> <1@x>/.test(raw), 'MIME headers (RFC 2047 subject, threading)');
const body = Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
ok(body === 'Zeile ü\nzwei', 'body round-trips UTF-8');
ok(!/Bcc/.test(raw) && !/\n.*\nInjected:/.test(buildRaw({ to: 'a@b.com\r\nBcc: evil@x.com', subject: 's', body: 'b' })), 'header injection stripped');
const inj = Buffer.from(buildRaw({ to: 'a@b.com\r\nBcc: evil@x.com', subject: 's', body: 'b' }), 'base64url').toString('utf8');
ok(!/^Bcc:/m.test(inj), 'CRLF in To cannot add a Bcc header');
