import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, toNamespacedPath } from 'node:path';

const adb = resolve(process.argv[2] || process.env.POR_ADB_TEST_BINARY || 'adb');
const directory = await mkdtemp(join(tmpdir(), 'Por Auto 中文 '));
const file = join(directory, 'u2.jar');
const payload = Buffer.from('Verified automation component fixture');
await writeFile(file, payload);
const sockets = new Set();
let chunks = [];
let protocolError;
// Minimal loopback target: exercise the real bundled ADB's local stat/read, without a phone.
const server = net.createServer(socket => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => {});
  let buffer = Buffer.alloc(0);
  let sync = false;
  socket.on('data', bytes => {
    buffer = Buffer.concat([buffer, bytes]);
    try {
      while (true) {
        if (!sync) {
          if (buffer.length < 4) return;
          const length = Number.parseInt(buffer.subarray(0, 4).toString(), 16);
          assert.ok(Number.isFinite(length) && length <= 4096, 'Invalid smart-socket request');
          if (buffer.length < length + 4) return;
          const request = buffer.subarray(4, length + 4).toString();
          buffer = buffer.subarray(length + 4);
          if (request === 'host:version') { socket.end('OKAY00040029'); return; }
          if (request.endsWith('features')) { socket.end('OKAY0000'); return; }
          if (request.startsWith('host:tport:')) {
            socket.write(Buffer.concat([Buffer.from('OKAY'), Buffer.from([1, 0, 0, 0, 0, 0, 0, 0])]));
            continue;
          }
          if (request.startsWith('host:transport')) { socket.write('OKAY'); continue; }
          assert.equal(request, 'sync:', 'Unexpected ADB service');
          sync = true;
          socket.write('OKAY');
          continue;
        }
        if (buffer.length < 8) return;
        const id = buffer.subarray(0, 4).toString();
        const length = buffer.readUInt32LE(4);
        if (id === 'DONE' || id === 'QUIT') {
          buffer = buffer.subarray(8);
          if (id === 'QUIT') { socket.end(); return; }
          socket.write(Buffer.from('OKAY\0\0\0\0'));
          continue;
        }
        assert.ok(length <= 1024 * 1024, 'Unexpected sync payload size');
        if (buffer.length < length + 8) return;
        const data = buffer.subarray(8, length + 8);
        buffer = buffer.subarray(length + 8);
        if (id === 'STAT') socket.write(Buffer.concat([Buffer.from('STAT'), Buffer.alloc(12)]));
        else if (id === 'DATA') chunks.push(data);
        else assert.equal(id, 'SEND', 'Unexpected sync command');
      }
    } catch (error) { protocolError = error; socket.destroy(); }
  });
});

async function push(source, cwd) {
  chunks = [];
  const child = spawn(adb, ['-s', 'por-path-regression', 'push', source, '/data/local/tmp/por-path-test.jar'], {
    cwd, windowsHide: true,
    env: { ...process.env, ADB_SERVER_SOCKET: `tcp:127.0.0.1:${server.address().port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stdout.resume();
  child.stderr.on('data', bytes => { stderr += bytes.toString(); });
  const timeout = setTimeout(() => child.kill(), 15000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    if (protocolError) throw protocolError;
    return { code, stderr, bytes: Buffer.concat(chunks) };
  } finally { clearTimeout(timeout); }
}

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  if (process.platform === 'win32') {
    const original = await push(toNamespacedPath(file));
    if (original.code === 0) {
      assert.deepEqual(original.bytes, payload);
      console.log('Original verbatim path is accepted on this Windows runner; customer failure is environment-dependent');
    } else {
      assert.match(original.stderr, /cannot stat/);
      assert.equal(original.bytes.length, 0);
      console.log('Reproduced original Windows ADB cannot-stat failure');
    }
  }
  const fixed = await push('u2.jar', toNamespacedPath(directory));
  assert.equal(fixed.code, 0, fixed.stderr);
  assert.deepEqual(fixed.bytes, payload, 'ADB must read and transfer the exact verified file');
  console.log('Bundled ADB push passed from a directory containing spaces and Chinese characters');
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
