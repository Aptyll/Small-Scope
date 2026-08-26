// Minimal static file server for local dev.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = +(process.env.PORT || 8471);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.json': 'application/json',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.jpg': 'image/jpeg',
};

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/shot') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b64 = body.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(path.join(ROOT, 'shot.png'), Buffer.from(b64, 'base64'));
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const head = {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes',
    };
    // Range requests matter for the music: an <audio> element served a plain 200
    // treats a multi-MB mp3 as an unbounded stream (duration Infinity) and
    // cannot seek in it. One range, which is all a media element ever asks for.
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      const last = data.length - 1;
      const start = m[1] ? +m[1] : Math.max(0, data.length - (+m[2] || 0));
      const end = m[1] ? Math.min(last, m[2] ? +m[2] : last) : last;
      if (start > last || start > end) {
        res.writeHead(416, { 'Content-Range': 'bytes */' + data.length });
        res.end();
        return;
      }
      head['Content-Range'] = 'bytes ' + start + '-' + end + '/' + data.length;
      res.writeHead(206, head);
      res.end(data.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, head);
    res.end(data);
  });
}).listen(PORT, () => console.log('serving on http://localhost:' + PORT));
