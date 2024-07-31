#!/usr/bin/env node
'use strict';

const eol = require('eol')
const glob = require('glob')
const fs = require('fs')
const path = require('path')

async function run() {
  const argv = process.argv
  const inputFilesGlob = argv[argv.length - 1]
  const isWarmup = argv[argv.length - 2] === 'warmup'
  const isCrlf = argv[argv.length - 2] === 'crlf'

  const dir = process.cwd()

  console.log('Running in directory ' + dir)
  console.log('Files GLOB regex: ' + inputFilesGlob)
  console.log(isWarmup
    ? 'WARMUP: will only list files, no action will be performed'
    : 'Converting to ' + (isCrlf ? 'CRLF' : 'LF'))
  console.log('---')

  const files = path.isAbsolute(inputFilesGlob)
    ? [path.basename(inputFilesGlob)]
    : await glob(inputFilesGlob, { nodir: true });
  if (!files || files.length === 0) {
    return console.error('ERROR: no files found')
  }
  files.forEach(fileName => {
    console.log(fileName)
    if (isWarmup) {
      return;
    }
    if (!fs.existsSync(fileName)) {
      return console.error('ERROR: file ' + fileName + ' not found')
    }
    try {
      const fileContent = fs.readFileSync(path.join(dir, fileName)).toString()
      const convertFn = (isCrlf ? eol.crlf : eol.lf).bind(eol)
      fs.writeFileSync(fileName, convertFn(fileContent))
    } catch (error) {
      console.warn(error)
    }
  })
  console.log('---')
}

run()
