#!/usr/bin/env node
'use strict'

const eol = require('eol')
const { glob } = require('glob')
const fs = require('fs')
const path = require('path')

const USAGE = 'Usage: eolConverter [warmup] [lf|crlf] <glob>'
const TARGETS = new Set(['lf', 'crlf'])
const KEYWORDS = new Set(['lf', 'crlf', 'warmup'])
const MAX_BYTES = 256 * 1024 * 1024
const IGNORE = ['**/node_modules/**', '**/.git/**']

/**
 * Validate CLI arguments. The target defaults to LF; a leading `warmup` turns the run into a dry run.
 * A lone keyword is rejected rather than treated as a glob, so a forgotten pattern is not silently misread.
 * @param {string[]} args arguments without the node binary and script path
 * @returns {{ target: 'lf'|'crlf', dryRun: boolean, pattern: string }}
 * @throws {Error} with the usage text on any invalid input
 */
function parseArgs(args) {
  const dryRun = args[0] === 'warmup'
  const rest = dryRun ? args.slice(1) : args
  const [target, pattern] = rest.length === 2 ? rest : ['lf', rest[0]]
  if (rest.length > 2 || !TARGETS.has(target) || !pattern || KEYWORDS.has(pattern)) throw new Error(USAGE)
  return { target, dryRun, pattern }
}

/**
 * Only accept files that survive a lossless UTF-8 round-trip and contain no NUL byte.
 * @param {Buffer} buf file contents
 * @returns {boolean}
 */
function isUtf8Text(buf) {
  if (buf.includes(0)) return false
  return Buffer.from(buf.toString('utf8'), 'utf8').equals(buf)
}

/**
 * Overwrite an existing file in place, keeping its inode and with it the owner, group, mode,
 * ACLs, extended attributes and hard links. A read-only file fails to open instead of being replaced.
 * @param {string} file absolute path of the target file
 * @param {Buffer} content bytes to write
 */
function writeInPlace(file, content) {
  const fd = fs.openSync(file, 'r+')
  try {
    fs.writeFileSync(fd, content)
    fs.ftruncateSync(fd, content.length)
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Convert every file matching the glob. Sets `process.exitCode` to 1 if any file failed.
 * @param {string[]} [argv] CLI arguments, defaults to `process.argv.slice(2)`
 * @param {string} [cwd] directory the glob is resolved against, defaults to `process.cwd()`
 * @throws {Error} on usage errors or when no file matches
 */
async function run(argv = process.argv.slice(2), cwd = process.cwd()) {
  const { target, dryRun, pattern } = parseArgs(argv)
  const convert = target === 'crlf' ? eol.crlf : eol.lf

  console.log(`cwd: ${cwd}`)
  console.log(`pattern: ${pattern}`)
  console.log(dryRun
    ? `mode: warmup (dry run for ${target.toUpperCase()}, nothing written)`
    : `mode: convert to ${target.toUpperCase()}`)

  const files = (await glob(pattern, { cwd, nodir: true, absolute: true, ignore: IGNORE })).sort()
  if (files.length === 0) throw new Error('no files matched')

  const stats = { changed: 0, unchanged: 0, skipped: 0, failed: 0 }
  for (const file of files) {
    try {
      const st = fs.lstatSync(file)
      if (!st.isFile()) { stats.skipped++; console.log(`SKIP not a regular file: ${file}`); continue }
      if (st.size > MAX_BYTES) { stats.skipped++; console.log(`SKIP too large: ${file}`); continue }
      const input = fs.readFileSync(file)
      if (!isUtf8Text(input)) { stats.skipped++; console.log(`SKIP not UTF-8 text: ${file}`); continue }
      const output = Buffer.from(convert(input.toString('utf8')), 'utf8')
      if (output.equals(input)) { stats.unchanged++; continue }
      if (!dryRun) writeInPlace(file, output)
      stats.changed++
      console.log(`${dryRun ? 'WOULD CHANGE' : 'CHANGED'}: ${file}`)
    } catch (err) {
      stats.failed++
      console.error(`FAIL: ${file}: ${err.message}`)
    }
  }
  console.log(`changed=${stats.changed} unchanged=${stats.unchanged} skipped=${stats.skipped} failed=${stats.failed}`)
  if (stats.failed > 0) process.exitCode = 1
}

module.exports = { parseArgs, isUtf8Text, writeInPlace, run }

if (require.main === module) {
  run().catch(err => {
    console.error(`ERROR: ${err.message}`)
    process.exitCode = 2
  })
}
