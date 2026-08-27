#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

process.on('uncaughtException', (error) => {
  console.error(`Development startup failed: ${error.message}`);
  process.exit(1);
});

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const composeDir = join(root, 'infra/compose/local');
const envFile = join(composeDir, '.env');
const devDir = join(root, '.dev');
const processor = join(devDir, 'media-preview-processor');
const server = join(devDir, 'dream-weave-server');
const worker = join(devDir, 'preview-worker');
const composeArgs = ['compose', '-f', 'compose.yaml', '-f', 'compose.dev.yaml'];

if (!existsSync(envFile)) {
  console.error('Missing infra/compose/local/.env. Copy .env.example and fill the required secrets first.');
  process.exit(2);
}

const fileEnv = parseEnv(await readTextFile(envFile));
const env = { ...process.env, ...fileEnv };
// Deliberately scoped to Vite's development server. These credentials never
// participate in a production build or the container-only acceptance stack.
const viteEnv = {
  ...env,
  VITE_DW_LOCAL_AUTO_LOGIN_EMAIL: required('DW_BOOTSTRAP_ADMIN_EMAIL'),
  VITE_DW_LOCAL_AUTO_LOGIN_PASSWORD: required('DW_BOOTSTRAP_ADMIN_PASSWORD'),
};
const nativeEnv = {
  ...env,
  DATABASE_URL: localDatabaseURL(required('DW_DATABASE_URL')),
  DW_S3_ENDPOINT: 'http://localhost:9000',
  DW_S3_BUCKET: required('DW_S3_BUCKET'),
  DW_S3_ACCESS_KEY: required('DW_MINIO_ACCESS_KEY'),
  DW_S3_SECRET_KEY: required('DW_MINIO_SECRET_KEY'),
  DW_S3_BROWSER_UPLOAD_ENDPOINT: 'https://app.localhost/internal/object-upload',
  DW_APP_ORIGIN: 'https://app.localhost',
  DW_PREVIEW_ORIGIN: 'https://preview.localhost',
  DW_ONLYOFFICE_DOCUMENT_SERVER_URL: 'https://office.localhost',
  DW_OFFICE_SOURCE_PROXY_BASE: 'http://dream-weave-host:18081/internal',
  DW_OFFICE_SOURCE_PROXY_PORT: '18081',
  DW_HTTP_ADDR: '127.0.0.1:18080',
  // Docker Desktop forwards the private source request through the host
  // loopback interface, so this is the peer observed by the host listener.
  DW_OFFICE_DOCUMENT_SERVER_CIDRS: '127.0.0.1/32',
  DW_PREVIEW_PROCESSOR: processor,
  DW_MIGRATIONS_DIR: join(root, 'apps/server/migrations'),
};

let children = [];
let restarting = false;
let stopping = false;
let backendStamp = 0;

await run('make', ['local-certs'], { cwd: composeDir });
await run('docker', [...composeArgs, 'up', '-d', '--build', 'postgres', 'minio', 'onlyoffice-document-server', 'office-viewer-shell'], { cwd: composeDir, env });
// `compose wait` is inconsistent for short-lived completed containers across
// Compose releases. Run this idempotent bucket initializer synchronously.
await run('docker', [...composeArgs, 'run', '--rm', 'minio-init'], { cwd: composeDir, env });
await restartBackend();
children.push(start('vite', 'pnpm', ['--filter', '@dream-weave/canvas-app', 'dev', '--host', '0.0.0.0'], { cwd: root, env: viteEnv }));
await run('docker', [...composeArgs, 'up', '-d', '--no-deps', 'reverse-proxy'], { cwd: composeDir, env });

console.log('\nDevelopment stack is ready: https://app.localhost');
console.log('Frontend changes use Vite HMR. Go and processor changes restart automatically.');
console.log('Press Ctrl+C to stop host processes and the proxy; use `make dev-down` to remove containers.\n');
backendStamp = await newestMtime(join(root, 'apps/server'));
const timer = setInterval(checkBackendChanges, 900);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function checkBackendChanges() {
  if (restarting || stopping) return;
  const current = await newestMtime(join(root, 'apps/server'));
  if (current > backendStamp) {
    backendStamp = current;
    await restartBackend();
  }
}

async function restartBackend() {
  if (restarting) return;
  restarting = true;
  try {
    for (const child of children.filter((child) => child.kind === 'backend')) stop(child);
    children = children.filter((child) => child.kind !== 'backend');
    await mkdir(devDir, { recursive: true });
    await run('go', ['build', '-o', processor, './apps/server/cmd/media-preview-processor'], { cwd: root, env: nativeEnv });
    await run('go', ['build', '-o', server, './apps/server/cmd/dream-weave-server'], { cwd: root, env: nativeEnv });
    await run('go', ['build', '-o', worker, './apps/server/cmd/preview-worker'], { cwd: root, env: nativeEnv });
    await run('go', ['run', './apps/server/cmd/migrate'], { cwd: root, env: nativeEnv });
    children.push(start('server', server, [], { cwd: root, env: nativeEnv, kind: 'backend' }));
    children.push(start('preview-worker', worker, [], { cwd: root, env: nativeEnv, kind: 'backend' }));
    await waitForServer();
  } finally {
    restarting = false;
  }
}

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:18080/readyz');
      if (response.status === 204) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('local server did not become ready on http://127.0.0.1:18080/readyz');
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  for (const child of children) stop(child);
  await run('docker', [...composeArgs, 'stop', 'reverse-proxy'], { cwd: composeDir, env, allowFailure: true });
  process.exit(0);
}

function start(name, command, args, options) {
  const child = spawn(command, args, { ...options, stdio: 'inherit', detached: process.platform !== 'win32' });
  child.kind = options.kind || 'frontend';
  child.on('exit', (code) => { if (!stopping && code && !restarting) console.error(`${name} exited with code ${code}`); });
  return child;
}

function stop(child) {
  if (!child.pid || child.exitCode !== null) return;
  try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM'); } catch { /* already stopped */ }
}

function required(name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required in infra/compose/local/.env`);
  return value;
}

function localDatabaseURL(value) {
  const url = new URL(value);
  url.hostname = '127.0.0.1';
  return url.toString();
}

function parseEnv(raw) {
  return Object.fromEntries(raw.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return [];
    const index = trimmed.indexOf('=');
    if (index < 1) return [];
    return [[trimmed.slice(0, index), trimmed.slice(index + 1)]];
  }));
}

async function readTextFile(path) {
  // Keep parsing dependency-free: the local .env format is KEY=value only.
  const { readFile } = await import('node:fs/promises');
  return readFile(path, 'utf8');
}

async function newestMtime(directory) {
  let newest = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, await newestMtime(path));
    else if (entry.isFile()) newest = Math.max(newest, (await stat(path)).mtimeMs);
  }
  return newest;
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0 || options.allowFailure) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}
