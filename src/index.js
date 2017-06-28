#!/usr/bin/env node
'use strict';

const eol = require('eol')
const glob = require("glob")
const fs = require('fs')
const path = require('path')

const argv = process.argv;
const inputFiles = argv[argv.length - 1]
const isWarmup = argv[argv.length - 2] === 'warmup'
const isCrlf = argv[argv.length - 2] === 'crlf'

const dir = process.cwd()
console.log('Running in directory ' + dir)
console.log('Files GLOB regex: ' + inputFiles)
console.log(isWarmup ? 'WARMUP: will only list files, no action will be performed - run `convertToLF` to do conversion' : '')
console.log('---')

glob(inputFiles, null, function (er, files) {
  if (!files || files.length === 0) {
    return console.error('ERROR: no files found')
  }
  files.forEach(fileName => {
    console.log(fileName)
    if (!isWarmup) {
      try {
        const file = fs.readFileSync(path.join(dir, fileName))
        const converted = isCrlf ? eol.crlf(file.toString()) : eol.lf(file.toString())
        fs.writeFileSync(fileName, converted);
      } catch (error) {
        console.warn(error)
      }
    }
  })
  console.log('---')
})
