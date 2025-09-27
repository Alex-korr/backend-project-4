// Simple test runner to debug issues
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import nock from 'nock'
import load from './src/pageLoader.js'

// Set test environment
process.env.NODE_ENV = 'test'

const runTest = async () => {
  try {
    console.log('Setting up test environment...')

    // Disable real network requests
    nock.disableNetConnect()

    // Simple HTML fixture for testing
    const simpleHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <title>Test Page</title>
</head>
<body>
    <h1>Hello World</h1>
</body>
</html>`

    // Mock the HTTP request
    nock('https://ru.hexlet.io')
      .get('/courses')
      .reply(200, simpleHtml)

    console.log('Nock mock set up for https://ru.hexlet.io/courses')

    // Create temp directory
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'page-loader-test-'))
    console.log('Created temp directory:', tmpDir)

    // Run page loader
    console.log('Running page loader...')
    const result = await load('https://ru.hexlet.io/courses', tmpDir)
    console.log('Page loader result:', result)

    // Check if file was created
    const fileStat = await fs.stat(result)
    console.log('File size:', fileStat.size)

    // Read and display content
    const content = await fs.readFile(result, 'utf-8')
    console.log('File content length:', content.length)
    console.log('First 200 chars:', content.substring(0, 200))

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true })
    console.log('Test completed successfully!')
  }
  catch (error) {
    console.error('Test failed:', error.message)
    console.error(error.stack)
  }
}

runTest()
