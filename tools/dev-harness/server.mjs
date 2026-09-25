#!/usr/bin/env node
// Development harness server.
//
// Serves the VibeLight user interface with the layout of the installed widget (see the install
// rules in CMakeLists.txt) and replaces the TV and WebAssembly parts with the mocks of this
// directory, so the interface can be used and tested in a desktop browser:
//
//   node tools/dev-harness/server.mjs [--port 8080]
//
// Then open http://localhost:8080/ (see mocks/tizen.js and mocks/moonlight-wasm.js for the options).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS_DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HARNESS_DIR, '..', '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.crt': 'application/x-x509-ca-cert',
};

// Maps a path of the widget to the file of the repository it is installed from
const ROUTES = [
  { prefix: '/mocks/', dir: join(HARNESS_DIR, 'mocks') },
  { prefix: '/platform/', dir: join(ROOT, 'wasm', 'platform') },
  { prefix: '/static/', dir: join(ROOT, 'wasm', 'static') },
  { prefix: '/service/', dir: join(ROOT, 'res', 'service') },
];

const SINGLE_FILES = {
  '/platform.js': join(ROOT, 'res', 'platform.js'),
  '/moonlight-wasm.js': join(HARNESS_DIR, 'mocks', 'moonlight-wasm.js'),
  '/config.xml': join(ROOT, 'res', 'config.xml'),
};

function safeJoin(dir, relativePath) {
  const target = normalize(join(dir, relativePath));
  return target === dir || target.startsWith(dir + sep) ? target : null;
}

function resolveFile(pathname) {
  if (SINGLE_FILES[pathname]) {
    return SINGLE_FILES[pathname];
  }
  for (const route of ROUTES) {
    if (pathname.startsWith(route.prefix)) {
      return safeJoin(route.dir, decodeURIComponent(pathname.slice(route.prefix.length)));
    }
  }
  return null;
}

// The widget page, with the TV mocks loaded before the platform scripts
async function renderIndex() {
  const html = await readFile(join(ROOT, 'wasm', 'index.html'), 'utf8');
  return html
    .replace('<head>', '<head>\n  <script type="text/javascript" src="mocks/tizen.js"></script>')
    .replace('$WEBAPIS/webapis/webapis.js', 'mocks/webapis.js');
}

export function startHarnessServer(port = 8080) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        response.writeHead(200, { 'Content-Type': MIME_TYPES['.html'], 'Cache-Control': 'no-store' });
        response.end(await renderIndex());
        return;
      }
      if (url.pathname === '/mocks/webapis.js') {
        // The Samsung product API is part of mocks/tizen.js
        response.writeHead(200, { 'Content-Type': MIME_TYPES['.js'] });
        response.end('// Provided by mocks/tizen.js\n');
        return;
      }
      const file = resolveFile(url.pathname);
      if (!file || !(await stat(file)).isFile()) {
        throw new Error('Not found');
      }
      response.writeHead(200, {
        'Content-Type': MIME_TYPES[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(await readFile(file));
    } catch (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Not found: ' + url.pathname);
    }
  });
  return new Promise((resolvePromise) => {
    server.listen(port, '127.0.0.1', () => resolvePromise(server));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const portIndex = process.argv.indexOf('--port');
  const port = portIndex !== -1 ? parseInt(process.argv[portIndex + 1], 10) : 8080;
  startHarnessServer(port).then(() => {
    console.log(`VibeLight harness running on http://localhost:${port}/`);
    console.log('Options: ?scenario=fresh|paired&platform=6.5&panel=4k&network=wifi&signal=0.8&capacity=80');
  });
}
