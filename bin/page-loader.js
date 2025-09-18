#!/usr/bin/env node

import { program } from 'commander'
import { resolve } from 'node:path'
import load from '../src/pageLoader.js'

program
  .name('page-loader')
  .description('Page loader utility')
  .version('1.0.0')
  .argument('<url>', 'URL of the page to download')
  .option('-o --output [dir]', 'output directory (defaults to current)', process.cwd())
  .action(async (url, options) => {
    const outputPath = resolve(options.output)
    try {
      const filePath = await load(url, outputPath)
      console.log(filePath)
    }
    catch (error) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

program.parse()
