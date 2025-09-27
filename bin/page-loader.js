#!/usr/bin/env node

import { program } from 'commander'
import { resolve } from 'node:path'
import { mkdir, access } from 'node:fs/promises'
import load from '../src/pageLoader.js'
import debug from 'debug'

const log = debug('page-loader')

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
    log('Page-loader started with URL: %s', url)

    // Use URL-based directory name if no output specified
    const defaultDir = generateDirName(url)
    const outputPath = resolve(options.output || defaultDir)

    log('Output directory: %s', outputPath)
    log('Using %s output directory', options.output ? 'specified' : 'auto-generated')

    try {
      // For CLI mode, create output directory if it doesn't exist
      try {
        await access(outputPath)
      }
      catch (error) {
        if (error.code === 'ENOENT') {
          log('Output directory does not exist, creating: %s', outputPath)
          await mkdir(outputPath, { recursive: true })
        }
        else {
          throw error
        }
      }

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
