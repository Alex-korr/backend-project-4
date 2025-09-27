#!/usr/bin/env node

import { program } from 'commander'
import { resolve } from 'node:path'
import load from '../src/pageLoader.js'
import debug from 'debug'

const log = debug('page-loader')

program
  .name('page-loader')
  .description('Page loader utility')
  .version('1.0.0')
  .argument('<url>', 'URL of the page to download')
  .option('-o --output [dir]', 'output directory (defaults to URL-based name)')
  .action(async (url, options) => {
    log('Page-loader started with URL: %s', url)

    // Use current directory if no output specified (download to current workdir)
    const outputPath = resolve(options.output || process.cwd())

    log('Output directory: %s', outputPath)
    log('Using %s output directory', options.output ? 'specified' : 'current workdir')

    try {
      const filePath = await load(url, outputPath)
      log('Operation completed successfully: %s', filePath)
      console.log(filePath)
    }
    catch (error) {
      log('Operation failed: %s', error.message)
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

program.parse()
