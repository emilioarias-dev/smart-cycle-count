// Scratch proxy on :3001 in front of the API on :3002, to simulate failures.
// Mode file `mode`: pass | slow (GET +1.5 s) | slow-post (POST +1.5 s) |
// reset (cut every connection) | drop-post (forward POSTs, then cut the
// connection without the answer) | 502-after-post (forward, then answer 502)
// | truncated-post (forward, then a cut-off JSON body) | slow-insights (GET
// /insights +1.5 s) | 502-insights (GET /insights answers 502). Logs each request.
const os = require('os');
const path = require('path');
// Runtime state (proxy and Gemini modes, request log), outside the repository.
const STATE = process.env.CHECKS_STATE ?? path.join(os.tmpdir(), 'scc-browser-checks');
require('fs').mkdirSync(STATE, { recursive: true });
const http = require('http');
const fs = require('fs');
const mode = () => (fs.existsSync(path.join(STATE, 'mode')) ? fs.readFileSync(path.join(STATE, 'mode'), 'utf8').trim() : 'pass');
http.createServer((req, res) => {
  const m = mode();
  if (m === 'reset') { req.socket.destroy(); return; }
  if (m === '502-insights' && req.url.startsWith('/insights')) { res.writeHead(502, { 'content-type': 'text/plain' }); res.end('Bad gateway (simulated)'); return; }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const forward = () => {
      const up = http.request({ host: '127.0.0.1', port: 3002, path: req.url, method: req.method, headers: req.headers }, (r) => {
        if (m === 'drop-post' && req.method === 'POST') { r.resume(); r.on('end', () => req.socket.destroy()); return; }
        if (m === '502-after-post' && req.method === 'POST') { r.resume(); r.on('end', () => { res.writeHead(502, { 'content-type': 'text/plain' }); res.end('Bad gateway (simulated)'); }); return; }
        if (m === 'truncated-post' && req.method === 'POST') { r.resume(); r.on('end', () => { res.writeHead(r.statusCode, { 'content-type': 'application/json' }); res.end('{"plan":{"id":'); }); return; }
        res.writeHead(r.statusCode, r.headers); r.pipe(res);
      });
      up.on('error', () => req.socket.destroy());
      up.end(Buffer.concat(chunks));
    };
    fs.appendFileSync(path.join(STATE, 'requests.log'), `${new Date().toISOString()} ${req.method} ${req.url}\n`);
    if (m === 'slow' && req.method === 'GET') setTimeout(forward, 1500);
    else if (m === 'slow-post' && req.method === 'POST') setTimeout(forward, 1500);
    else if (m === 'slow-insights' && req.url.startsWith('/insights')) setTimeout(forward, 1500);
    else forward();
  });
}).listen(3001, '127.0.0.1', () => console.log('proxy 3001 -> 3002'));
