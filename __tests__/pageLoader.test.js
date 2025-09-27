import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import nock from 'nock'
import load from '../src/pageLoader.js'

// Get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Utilities for working with fixtures
const getFixturePath = filename => path.join(__dirname, '__fixtures__', filename)
const readFixture = async (filename) => {
  const content = await fs.readFile(getFixturePath(filename), 'utf-8')
  return content.trim() // remove extra spaces/newlines
}

// URL we'll be testing
const url = 'https://ru.hexlet.io/courses'
const expectedFilename = 'ru-hexlet-io-courses.html'

describe('pageLoader', () => {
  let tmpDir

  // Set test environment to disable listr2 progress bars
  beforeAll(() => {
    process.env.NODE_ENV = 'test'
    nock.disableNetConnect()
  })

  // Re-enable HTTP requests after all tests and restore environment
  afterAll(() => {
    nock.enableNetConnect()
    delete process.env.NODE_ENV
  })

  // Create new temporary folder before each test
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'page-loader-'))
    // Clear any existing mocks
    nock.cleanAll()
  })

  // Remove folder after each test
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  // Test 1: Basic functionality - download simple HTML page
  it('should download HTML page and save to output directory', async () => {
    const simpleHtml = await readFixture('expected.html')

    nock('https://ru.hexlet.io')
      .get('/courses')
      .reply(200, simpleHtml)

    const outputPath = path.join(tmpDir, expectedFilename)
    const resultPath = await load(url, tmpDir)

    // Check that function returned correct path
    expect(resultPath).toBe(outputPath)

    // Check that file was actually created
    await expect(fs.stat(outputPath)).resolves.toHaveProperty('size')

    // Check that content matches fixture
    const savedContent = await fs.readFile(outputPath, 'utf-8')
    expect(savedContent.trim()).toBe(simpleHtml)
  }, 10000)

  // Test 2: Basic error handling - 404 error
  it('should handle 404 error', async () => {
    nock('https://example.com')
      .get('/notfound')
      .reply(404, 'Not Found')

    await expect(load('https://example.com/notfound', tmpDir))
      .rejects
      .toThrow('Page not found (404): https://example.com/notfound')
  })
})
