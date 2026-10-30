import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

/**
 * Static server for the project folder (the scene uses ES modules, which file:// blocks).
 * Supports byte ranges, which the browser needs to seek inside video files.
 */
export function startServer(root, port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      let p = path.normalize(path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
      if (p !== root && !p.startsWith(root + path.sep)) return res.writeHead(403).end();
      let st;
      try {
        st = await fs.promises.stat(p);
        if (st.isDirectory()) {
          p = path.join(p, 'index.html');
          st = await fs.promises.stat(p);
        }
      } catch {
        return res.writeHead(404).end('not found');
      }

      const headers = {
        'content-type': TYPES[path.extname(p).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
        'accept-ranges': 'bytes',
      };
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      let start = 0;
      let end = st.size - 1;
      if (m && (m[1] || m[2])) {
        if (m[1]) {
          start = Number(m[1]);
          if (m[2]) end = Math.min(Number(m[2]), end);
        } else start = Math.max(0, st.size - Number(m[2])); // suffix range: last N bytes
        if (start > end || start >= st.size) {
          return res.writeHead(416, { 'content-range': `bytes */${st.size}` }).end();
        }
        res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
      } else {
        res.writeHead(200, { ...headers, 'content-length': st.size });
      }
      if (req.method === 'HEAD' || st.size === 0) return res.end();
      fs.createReadStream(p, { start, end }).on('error', () => res.destroy()).pipe(res);
    });
    server.listen(port, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }),
    );
  });
}
