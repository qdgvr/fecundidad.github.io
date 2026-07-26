#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const options = {
  host: '127.0.0.1',
  port: 8765,
  root: process.cwd()
};

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === '--host') options.host = process.argv[++index];
  else if (argument === '--port') options.port = Number(process.argv[++index]);
  else if (argument === '--root') options.root = process.argv[++index];
  else if (argument === '--help' || argument === '-h') {
    console.log('Usage: node serve-range.mjs [--root PATH] [--host HOST] [--port PORT]');
    process.exit(0);
  } else {
    throw new Error(`Unexpected argument: ${argument}`);
  }
}

if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
  throw new Error(`Invalid port: ${options.port}`);
}

const root = path.resolve(options.root);
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.geojson', 'application/geo+json'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.pmtiles', 'application/vnd.pmtiles'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2']
]);

const resolveRequestPath = pathname => {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded.replace(/^\/+/, '');
  const candidate = path.resolve(root, relative || 'index.html');
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  return candidate;
};

const parseRange = (value, size) => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || '');
  if (!match) return null;

  let start;
  let end;
  if (match[1]) {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  } else if (match[2]) {
    const suffixLength = Number(match[2]);
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
};

const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method || '')) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }

    const requestUrl = new URL(request.url || '/', 'http://localhost');
    let filePath = resolveRequestPath(requestUrl.pathname);
    if (!filePath) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    let details = await stat(filePath);
    if (details.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      details = await stat(filePath);
    }
    if (!details.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' });

    const headers = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Type': contentTypes.get(path.extname(filePath)) || 'application/octet-stream'
    };
    const requestedRange = request.headers.range;
    if (requestedRange) {
      const range = parseRange(requestedRange, details.size);
      if (!range) {
        response.writeHead(416, {
          ...headers,
          'Content-Range': `bytes */${details.size}`
        });
        response.end();
        return;
      }
      response.writeHead(206, {
        ...headers,
        'Content-Length': range.end - range.start + 1,
        'Content-Range': `bytes ${range.start}-${range.end}/${details.size}`
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(filePath, range).pipe(response);
      return;
    }

    response.writeHead(200, {
      ...headers,
      'Content-Length': details.size
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(filePath).pipe(response);
  } catch (error) {
    const statusCode = error?.code === 'ENOENT' ? 404 : 500;
    response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(statusCode === 404 ? 'Not found' : 'Internal server error');
  }
});

server.listen(options.port, options.host, () => {
  console.log(`Range server: http://${options.host}:${options.port}/`);
  console.log(`Root: ${root}`);
});
