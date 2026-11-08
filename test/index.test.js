'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const { parseArgs, isUtf8Text, writeInPlace, run } = require('../src/index.js')

const BIN = path.resolve(__dirname, '../src/index.js')
const USAGE = 'Usage: eolConverter [warmup] [lf|crlf] <glob>'
const MAX_BYTES = 256 * 1024 * 1024
const IS_WINDOWS = process.platform === 'win32'
const IS_ROOT = !IS_WINDOWS && process.getuid() === 0
// Windows has no POSIX permission bits; Node reports 0o666 for every writable file there.
const NO_POSIX_MODES = { skip: IS_WINDOWS && 'POSIX file modes not supported on Windows' }

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'eol-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function write(dir, name, content, mode) {
  const file = path.join(dir, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, { mode })
  return file
}

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

function captureConsole(t) {
  const log = t.mock.method(console, 'log', () => {})
  const error = t.mock.method(console, 'error', () => {})
  return {
    get out() { return log.mock.calls.map(c => c.arguments.join(' ')) },
    get err() { return error.mock.calls.map(c => c.arguments.join(' ')) }
  }
}

// Runs the converter in-process and returns the exit code it set, without leaking it to the test runner.
async function runIn(t, argv, cwd) {
  const saved = process.exitCode
  t.after(() => { process.exitCode = saved })
  process.exitCode = undefined
  await run(argv, cwd)
  return process.exitCode
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' })
}

test('parseArgs', async (t) => {
  await t.test('accepts each target with a pattern', () => {
    for (const target of ['lf', 'crlf']) {
      assert.deepEqual(parseArgs([target, '**/*.js']), { target, dryRun: false, pattern: '**/*.js' })
    }
  })

  await t.test('defaults to LF when only a pattern is given', () => {
    assert.deepEqual(parseArgs(['**/*.js']), { target: 'lf', dryRun: false, pattern: '**/*.js' })
  })

  await t.test('accepts warmup with an optional target', () => {
    assert.deepEqual(parseArgs(['warmup', '*.js']), { target: 'lf', dryRun: true, pattern: '*.js' })
    assert.deepEqual(parseArgs(['warmup', 'lf', '*.js']), { target: 'lf', dryRun: true, pattern: '*.js' })
    assert.deepEqual(parseArgs(['warmup', 'crlf', '*.js']), { target: 'crlf', dryRun: true, pattern: '*.js' })
  })

  await t.test('rejects wrong argument count', () => {
    for (const args of [[], ['warmup'], ['lf', 'a', 'b'], ['warmup', 'lf', 'a', 'b']]) {
      assert.throws(() => parseArgs(args), { message: USAGE })
    }
  })

  await t.test('rejects a keyword in place of the pattern', () => {
    for (const args of [['lf'], ['crlf'], ['warmup', 'crlf'], ['lf', 'warmup'], ['crlf', 'warmup', '*.js']]) {
      assert.throws(() => parseArgs(args), { message: USAGE })
    }
  })

  await t.test('rejects unknown target', () => {
    assert.throws(() => parseArgs(['cr', '*.js']), { message: USAGE })
    assert.throws(() => parseArgs(['LF', '*.js']), { message: USAGE })
    assert.throws(() => parseArgs(['warmup', 'cr', '*.js']), { message: USAGE })
  })

  await t.test('rejects empty pattern', () => {
    assert.throws(() => parseArgs(['lf', '']), { message: USAGE })
  })
})

test('isUtf8Text', async (t) => {
  await t.test('accepts ASCII, multi-byte UTF-8 and empty input', () => {
    assert.equal(isUtf8Text(Buffer.from('plain\r\n')), true)
    assert.equal(isUtf8Text(Buffer.from('héllo €\n')), true)
    assert.equal(isUtf8Text(Buffer.alloc(0)), true)
  })

  await t.test('rejects a NUL byte anywhere', () => {
    assert.equal(isUtf8Text(Buffer.from('a\0b')), false)
    assert.equal(isUtf8Text(Buffer.from('ab\0')), false)
  })

  await t.test('rejects UTF-16 encoded text', () => {
    assert.equal(isUtf8Text(Buffer.from('hi\n', 'utf16le')), false)
  })

  await t.test('rejects invalid and truncated UTF-8 sequences', () => {
    assert.equal(isUtf8Text(Buffer.from([0xff, 0xfe, 0x41])), false)
    assert.equal(isUtf8Text(Buffer.from([0x41, 0xe2, 0x82])), false)
  })
})

test('writeInPlace', async (t) => {
  await t.test('grows and shrinks the file to the new content and creates no other file', () => {
    const dir = tmpDir(t)
    const file = write(dir, 'out.txt', 'abc')
    writeInPlace(file, Buffer.from('longer content'))
    assert.equal(read(file), 'longer content')
    writeInPlace(file, Buffer.from('xy'))
    assert.equal(read(file), 'xy')
    assert.deepEqual(fs.readdirSync(dir), ['out.txt'])
  })

  await t.test('keeps the inode and mode', NO_POSIX_MODES, () => {
    const dir = tmpDir(t)
    const file = write(dir, 'out.txt', 'old', 0o640)
    fs.chmodSync(file, 0o640)
    const before = fs.statSync(file)
    writeInPlace(file, Buffer.from('new'))
    const after = fs.statSync(file)
    assert.equal(after.ino, before.ino)
    assert.equal(after.mode & 0o777, 0o640)
  })

  await t.test('refuses a read-only file and leaves it untouched', { skip: IS_ROOT || IS_WINDOWS }, () => {
    const dir = tmpDir(t)
    const file = write(dir, 'ro.txt', 'old', 0o444)
    assert.throws(() => writeInPlace(file, Buffer.from('new')), { code: 'EACCES' })
    assert.equal(read(file), 'old')
  })

  await t.test('rethrows when the file does not exist', () => {
    const dir = tmpDir(t)
    const file = path.join(dir, 'missing.txt')
    assert.throws(() => writeInPlace(file, Buffer.from('x')), { code: 'ENOENT' })
    assert.deepEqual(fs.readdirSync(dir), [])
  })
})

test('run', async (t) => {
  await t.test('lf converts CRLF files in sorted order and reports them', async (t) => {
    const dir = tmpDir(t)
    const b = write(dir, 'b.txt', 'one\r\ntwo\r\n')
    const a = write(dir, 'a.txt', 'x\r\n')
    const c = captureConsole(t)
    const code = await runIn(t, ['lf', '*.txt'], dir)
    assert.equal(code, undefined)
    assert.equal(read(a), 'x\n')
    assert.equal(read(b), 'one\ntwo\n')
    assert.deepEqual(c.out.slice(0, 3), [`cwd: ${dir}`, 'pattern: *.txt', 'mode: convert to LF'])
    assert.deepEqual(c.out.slice(3), [`CHANGED: ${a}`, `CHANGED: ${b}`, 'changed=2 unchanged=0 skipped=0 failed=0'])
    assert.deepEqual(c.err, [])
  })

  await t.test('defaults to LF when only a pattern is given', async (t) => {
    const dir = tmpDir(t)
    const f = write(dir, 'f.txt', 'a\r\nb\r\n')
    const c = captureConsole(t)
    await runIn(t, ['f.txt'], dir)
    assert.equal(read(f), 'a\nb\n')
    assert.ok(c.out.includes('mode: convert to LF'))
  })

  await t.test('crlf normalizes LF, lone CR and CRLF to CRLF', async (t) => {
    const dir = tmpDir(t)
    const f = write(dir, 'f.txt', 'a\rb\nc\r\nd')
    const c = captureConsole(t)
    await runIn(t, ['crlf', 'f.txt'], dir)
    assert.equal(read(f), 'a\r\nb\r\nc\r\nd')
    assert.ok(c.out.includes('mode: convert to CRLF'))
    assert.ok(c.out.includes('changed=1 unchanged=0 skipped=0 failed=0'))
  })

  await t.test('preserves multi-byte UTF-8 content', async (t) => {
    const dir = tmpDir(t)
    const f = write(dir, 'u.txt', 'héllo\r\n€ 日本\r\n')
    captureConsole(t)
    await runIn(t, ['lf', 'u.txt'], dir)
    assert.equal(read(f), 'héllo\n€ 日本\n')
  })

  await t.test('preserves the file mode of converted files, including bits the umask would clear', NO_POSIX_MODES, async (t) => {
    const dir = tmpDir(t)
    const f = write(dir, 'script.sh', '#!/bin/sh\r\necho hi\r\n')
    fs.chmodSync(f, 0o775)
    captureConsole(t)
    await runIn(t, ['lf', 'script.sh'], dir)
    assert.equal(fs.statSync(f).mode & 0o777, 0o775)
  })

  await t.test('leaves unchanged files untouched, including mtime', async (t) => {
    const dir = tmpDir(t)
    const f = write(dir, 'same.txt', 'already\nlf\n')
    const past = new Date('2000-01-01T00:00:00Z')
    fs.utimesSync(f, past, past)
    const c = captureConsole(t)
    await runIn(t, ['lf', 'same.txt'], dir)
    assert.equal(read(f), 'already\nlf\n')
    assert.equal(fs.statSync(f).mtime.getTime(), past.getTime())
    assert.ok(c.out.includes('changed=0 unchanged=1 skipped=0 failed=0'))
    assert.ok(!c.out.some(l => l.startsWith('CHANGED')))
  })

  await t.test('warmup reports what would change without writing', async (t) => {
    const dir = tmpDir(t)
    const f = write(dir, 'w.txt', 'a\r\nb\r\n')
    const c = captureConsole(t)
    await runIn(t, ['warmup', 'w.txt'], dir)
    assert.equal(read(f), 'a\r\nb\r\n')
    assert.ok(c.out.includes('mode: warmup (dry run for LF, nothing written)'))
    assert.ok(c.out.includes(`WOULD CHANGE: ${f}`))
    assert.ok(c.out.includes('changed=1 unchanged=0 skipped=0 failed=0'))
  })

  await t.test('warmup crlf previews a CRLF conversion without writing', async (t) => {
    const dir = tmpDir(t)
    const f = write(dir, 'w.txt', 'a\nb\n')
    const c = captureConsole(t)
    await runIn(t, ['warmup', 'crlf', 'w.txt'], dir)
    assert.equal(read(f), 'a\nb\n')
    assert.ok(c.out.includes('mode: warmup (dry run for CRLF, nothing written)'))
    assert.ok(c.out.includes(`WOULD CHANGE: ${f}`))
    assert.ok(c.out.includes('changed=1 unchanged=0 skipped=0 failed=0'))
  })

  await t.test('updates every hard link of a converted file', async (t) => {
    const dir = tmpDir(t)
    const a = write(dir, 'a.txt', 'x\r\n')
    const b = path.join(dir, 'b.other')
    fs.linkSync(a, b)
    captureConsole(t)
    await runIn(t, ['lf', 'a.txt'], dir)
    assert.equal(read(a), 'x\n')
    assert.equal(read(b), 'x\n')
    assert.equal(fs.statSync(a).ino, fs.statSync(b).ino)
  })

  await t.test('reports a read-only file as failed and leaves it untouched', { skip: IS_ROOT || IS_WINDOWS }, async (t) => {
    const dir = tmpDir(t)
    const f = write(dir, 'ro.txt', 'a\r\n', 0o444)
    const c = captureConsole(t)
    const code = await runIn(t, ['lf', 'ro.txt'], dir)
    assert.equal(code, 1)
    assert.equal(read(f), 'a\r\n')
    assert.ok(c.err[0].startsWith(`FAIL: ${f}: EACCES`))
    assert.ok(c.out.includes('changed=0 unchanged=0 skipped=0 failed=1'))
  })

  await t.test('skips files that are not UTF-8 text', async (t) => {
    const dir = tmpDir(t)
    const bin = write(dir, 'bin.dat', Buffer.from([0x41, 0x00, 0x0d, 0x0a]))
    const u16 = write(dir, 'u16.txt', Buffer.from('a\r\n', 'utf16le'))
    const c = captureConsole(t)
    await runIn(t, ['lf', '*'], dir)
    assert.deepEqual(fs.readFileSync(bin), Buffer.from([0x41, 0x00, 0x0d, 0x0a]))
    assert.deepEqual(fs.readFileSync(u16), Buffer.from('a\r\n', 'utf16le'))
    assert.ok(c.out.includes(`SKIP not UTF-8 text: ${bin}`))
    assert.ok(c.out.includes(`SKIP not UTF-8 text: ${u16}`))
    assert.ok(c.out.includes('changed=0 unchanged=0 skipped=2 failed=0'))
  })

  await t.test('skips symlinks and leaves their target alone', { skip: IS_WINDOWS }, async (t) => {
    const dir = tmpDir(t)
    const target = write(dir, 'target.txt', 'a\r\n')
    const link = path.join(dir, 'link.txt')
    fs.symlinkSync(target, link)
    const c = captureConsole(t)
    await runIn(t, ['lf', 'link.txt'], dir)
    assert.equal(read(target), 'a\r\n')
    assert.ok(c.out.includes(`SKIP not a regular file: ${link}`))
    assert.ok(c.out.includes('changed=0 unchanged=0 skipped=1 failed=0'))
  })

  await t.test('skips files above the size limit', async (t) => {
    const dir = tmpDir(t)
    const big = write(dir, 'big.txt', '')
    fs.truncateSync(big, MAX_BYTES + 1)
    const c = captureConsole(t)
    await runIn(t, ['lf', 'big.txt'], dir)
    assert.ok(c.out.includes(`SKIP too large: ${big}`))
    assert.ok(c.out.includes('changed=0 unchanged=0 skipped=1 failed=0'))
  })

  await t.test('processes a file exactly at the size limit', async (t) => {
    const dir = tmpDir(t)
    const edge = write(dir, 'edge.txt', '')
    fs.truncateSync(edge, MAX_BYTES)
    const c = captureConsole(t)
    await runIn(t, ['warmup', 'edge.txt'], dir)
    assert.ok(c.out.includes(`SKIP not UTF-8 text: ${edge}`))
  })

  await t.test('ignores node_modules and .git directories', async (t) => {
    const dir = tmpDir(t)
    const nm = write(dir, 'node_modules/dep/x.txt', 'a\r\n')
    const git = write(dir, '.git/x.txt', 'a\r\n')
    const ok = write(dir, 'src/x.txt', 'a\r\n')
    const c = captureConsole(t)
    await runIn(t, ['lf', '**/*.txt'], dir)
    assert.equal(read(nm), 'a\r\n')
    assert.equal(read(git), 'a\r\n')
    assert.equal(read(ok), 'a\n')
    assert.ok(c.out.includes('changed=1 unchanged=0 skipped=0 failed=0'))
  })

  await t.test('rejects when no file matches', async (t) => {
    const dir = tmpDir(t)
    captureConsole(t)
    await assert.rejects(runIn(t, ['lf', '*.nothing'], dir), { message: 'no files matched' })
  })

  await t.test('rejects on usage error before touching the file system', async (t) => {
    captureConsole(t)
    await assert.rejects(runIn(t, ['lf'], '/nonexistent-dir'), { message: USAGE })
  })

  await t.test('reports a per-file failure, continues and sets exit code 1', async (t) => {
    const dir = tmpDir(t)
    const bad = write(dir, 'bad.txt', 'a\r\n')
    const good = write(dir, 'good.txt', 'b\r\n')
    const original = fs.readFileSync
    t.mock.method(fs, 'readFileSync', (file, ...rest) => {
      if (file === bad) throw new Error('boom')
      return original.call(fs, file, ...rest)
    })
    const c = captureConsole(t)
    const code = await runIn(t, ['lf', '*.txt'], dir)
    assert.equal(code, 1)
    assert.equal(read(good), 'b\n')
    assert.deepEqual(c.err, [`FAIL: ${bad}: boom`])
    assert.ok(c.out.includes('changed=1 unchanged=0 skipped=0 failed=1'))
  })
})

test('cli', async (t) => {
  await t.test('exits 2 with usage on missing arguments', () => {
    const r = runCli([])
    assert.equal(r.status, 2)
    assert.equal(r.stderr.trim(), `ERROR: ${USAGE}`)
  })

  await t.test('exits 2 when nothing matches', (t) => {
    const dir = tmpDir(t)
    const r = runCli(['lf', '*.none'], dir)
    assert.equal(r.status, 2)
    assert.equal(r.stderr.trim(), 'ERROR: no files matched')
  })

  await t.test('exits 0 and converts on success', (t) => {
    const dir = tmpDir(t)
    const f = write(dir, 'f.txt', 'a\r\n')
    const r = runCli(['lf', 'f.txt'], dir)
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
    assert.equal(read(f), 'a\n')
    assert.ok(r.stdout.includes(`CHANGED: ${f}`))
  })

  await t.test('exits 0 and converts to LF without a target argument', (t) => {
    const dir = tmpDir(t)
    const f = write(dir, 'f.txt', 'a\r\n')
    const r = runCli(['f.txt'], dir)
    assert.equal(r.status, 0)
    assert.equal(read(f), 'a\n')
  })

  await t.test('exits 1 when a file cannot be read', { skip: IS_ROOT || IS_WINDOWS }, (t) => {
    const dir = tmpDir(t)
    const f = write(dir, 'locked.txt', 'a\r\n', 0o000)
    const r = runCli(['lf', 'locked.txt'], dir)
    assert.equal(r.status, 1)
    assert.ok(r.stderr.startsWith(`FAIL: ${f}: `))
    assert.ok(r.stdout.includes('changed=0 unchanged=0 skipped=0 failed=1'))
  })
})
