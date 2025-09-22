#!/usr/bin/env node

import { program } from 'commander'
import { resolve } from 'node:path'
import load from '../src/pageLoader.js'

// Generate directory name from URL
const generateDirName = (url) => {
  const urlObj = new URL(url)
  const fullPath = `${urlObj.hostname}${urlObj.pathname}`.replace(/\/$/, '')
  return fullPath.replace(/[^a-zA-Z0-9]/g, '-')
}

program
  .name('page-loader')
  .description('Page loader utility')
  .version('1.0.0')
  .argument('<url>', 'URL of the page to download')
  .option('-o --output [dir]', 'output directory (defaults to URL-based name)')
  .action(async (url, options) => {
    // Use URL-based directory name if no output specified
    const defaultDir = generateDirName(url)
    const outputPath = resolve(options.output || defaultDir)
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
