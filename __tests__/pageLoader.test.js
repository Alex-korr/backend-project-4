import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import nock from 'nock'
import debug from 'debug'
import load from '../src/pageLoader.js'

// Enable nock debug logging
const nockLog = debug('nock')
nock.recorder.rec({
  logging: (content) => {
    nockLog('HTTP Mock: %s', content)
  },
})

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
const expectedFilename = 'ru-hexlet-io-courses.html' // expected filename

describe('pageLoader', () => {
  let tmpDir

  // Disable real HTTP requests
  beforeAll(() => {
    nock.disableNetConnect()
  })

  // Re-enable HTTP requests after all tests
  afterAll(() => {
    nock.enableNetConnect()
  })

  // Mock server response BEFORE all tests
  beforeAll(async () => {
    const pageContent = await readFixture('expected.html')
    nock('https://ru.hexlet.io')
      .get('/courses')
      .reply(200, pageContent)
  })

  // Create new temporary folder before each test
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'page-loader-'))
  })

  // Remove folder after each test
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  // Main test
  it('should download page and save to output directory', async () => {
    // Clear and set up specific mock for this test
    nock.cleanAll()
    const pageContent = await readFixture('expected.html')
    nock('https://ru.hexlet.io')
      .get('/courses')
      .reply(200, pageContent)

    const outputPath = path.join(tmpDir, expectedFilename)
    const resultPath = await load(url, tmpDir)

    // Check that function returned correct path
    expect(resultPath).toBe(outputPath)

    // Check that file was actually created
    await expect(fs.stat(outputPath)).resolves.toHaveProperty('size')

    // Check that content matches fixture
    const savedContent = await fs.readFile(outputPath, 'utf-8')
    const fixtureContent = await readFixture('expected.html')
    expect(savedContent.trim()).toBe(fixtureContent)
  }, 10000)

  // New test for downloading images
  it('should download page with images and modify HTML', async () => {
    // Prepare mocks for this specific test
    nock.cleanAll() // Clear previous mocks

    // Mock HTML page with images
    const htmlWithImages = await readFixture('expected-with-images.html')
    nock('https://ru.hexlet.io')
      .get('/courses')
      .reply(200, htmlWithImages)

    // Mock image
    const imageBuffer = await fs.readFile(getFixturePath('nodejs.png'))
    nock('https://ru.hexlet.io')
      .get('/assets/professions/nodejs.png')
      .reply(200, imageBuffer)

    // Run function
    const outputPath = path.join(tmpDir, expectedFilename)
    const resultPath = await load(url, tmpDir)

    // Check main HTML file
    expect(resultPath).toBe(outputPath)
    await expect(fs.stat(outputPath)).resolves.toHaveProperty('size')

    // Check that HTML was modified (links became local)
    const savedHtml = await fs.readFile(outputPath, 'utf-8')
    const expectedModifiedHtml = await readFixture('expected-modified.html')
    expect(savedHtml.trim()).toBe(expectedModifiedHtml)

    // Check that resources folder was created
    const resourceDir = path.join(tmpDir, 'ru-hexlet-io-courses_files')
    await expect(fs.stat(resourceDir)).resolves.toHaveProperty('isDirectory')

    // Check that image was downloaded
    const imagePath = path.join(resourceDir, 'ru-hexlet-io-assets-professions-nodejs.png')
    await expect(fs.stat(imagePath)).resolves.toHaveProperty('size')

    // Check that image content is correct
    const savedImage = await fs.readFile(imagePath)
    expect(savedImage).toEqual(imageBuffer)
  }, 10000)

  // Test 3: Download all local resources (CSS, JS, HTML, images)
  it('should download all local resources and modify HTML', async () => {
    // Clear previous mocks
    nock.cleanAll()

    // Setup mocks for all resources
    const allResourcesHtml = await readFixture('expected-with-all-resources.html')
    const cssContent = await readFixture('application.css')
    const jsContent = await readFixture('runtime.js')
    const canonicalHtml = await readFixture('courses.html')
    const imageBuffer = await fs.readFile(getFixturePath('nodejs.png'))

    // Mock main page
    nock('https://ru.hexlet.io')
      .get('/courses')
      .reply(200, allResourcesHtml)

    // Mock all local resources
    nock('https://ru.hexlet.io')
      .get('/assets/application.css')
      .reply(200, cssContent)

    nock('https://ru.hexlet.io')
      .get('/packs/js/runtime.js')
      .reply(200, jsContent)

    nock('https://ru.hexlet.io')
      .get('/courses')
      .reply(200, canonicalHtml)

    nock('https://ru.hexlet.io')
      .get('/assets/professions/nodejs.png')
      .reply(200, imageBuffer)

    // Run page-loader
    const outputPath = path.join(tmpDir, expectedFilename)
    await load(url, tmpDir)

    // 1. Check that HTML was modified correctly
    const savedHtml = await fs.readFile(outputPath, 'utf-8')
    const expectedModifiedHtml = await readFixture('expected-all-resources-modified.html')
    expect(savedHtml.trim()).toBe(expectedModifiedHtml)

    // 2. Check that all 4 files were downloaded
    const resourceDir = path.join(tmpDir, 'ru-hexlet-io-courses_files')
    const files = await fs.readdir(resourceDir)
    expect(files).toHaveLength(4)

    // 3. Check that external links were not modified
    expect(savedHtml).toContain('https://cdn2.hexlet.io/assets/menu.css')
    expect(savedHtml).toContain('https://js.stripe.com/v3/')
  }, 15000)

  // ERROR HANDLING TESTS (Minimal set)
  describe('Error handling', () => {
    beforeEach(async () => {
      nock.cleanAll() // Clear all previous mocks
    })

    // Test 1: HTTP Errors (covers 404, 403, 500)
    it('should handle HTTP errors with user-friendly messages', async () => {
      // Test 404
      nock('https://example.com')
        .get('/not-found')
        .reply(404, 'Page not found')

      await expect(load('https://example.com/not-found', tmpDir))
        .rejects
        .toThrow('Page not found (404): https://example.com/not-found')
    })

    // Test 2: Network Errors (covers ENOTFOUND, ECONNREFUSED, ETIMEDOUT)
    it('should handle network errors with user-friendly messages', async () => {
      // Test DNS resolution failure
      nock('https://nonexistent-domain.com')
        .get('/page')
        .replyWithError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND nonexistent-domain.com' })

      await expect(load('https://nonexistent-domain.com/page', tmpDir))
        .rejects
        .toThrow('Cannot resolve hostname: https://nonexistent-domain.com/page')
    })

    // Test 3: Additional HTTP errors to improve coverage
    it('should handle additional HTTP errors', async () => {
      // Test 403 Forbidden
      nock('https://example.com')
        .get('/forbidden')
        .reply(403, 'Forbidden')

      await expect(load('https://example.com/forbidden', tmpDir))
        .rejects
        .toThrow('Access forbidden (403): https://example.com/forbidden')

      // Test 500 Server Error
      nock.cleanAll()
      nock('https://example.com')
        .get('/server-error')
        .reply(500, 'Internal Server Error')

      await expect(load('https://example.com/server-error', tmpDir))
        .rejects
        .toThrow('Server error (500): https://example.com/server-error')
    })

    // Test 4: Connection errors
    it('should handle connection errors', async () => {
      // Test connection refused
      nock('https://example.com')
        .get('/refused')
        .replyWithError({ code: 'ECONNREFUSED', message: 'Connection refused' })

      await expect(load('https://example.com/refused', tmpDir))
        .rejects
        .toThrow('Connection refused: https://example.com/refused')

      // Test timeout
      nock.cleanAll()
      nock('https://example.com')
        .get('/timeout')
        .replyWithError({ code: 'ETIMEDOUT', message: 'Request timeout' })

      await expect(load('https://example.com/timeout', tmpDir))
        .rejects
        .toThrow('Request timeout: https://example.com/timeout')
    })

    // Test 5: HTML without resources
    it('should handle HTML without any resources', async () => {
      const simpleHtml = '<html><head><title>Simple</title></head><body><h1>No Resources</h1></body></html>'

      nock('https://example.com')
        .get('/simple')
        .reply(200, simpleHtml)

      const result = await load('https://example.com/simple', tmpDir)
      const savedHtml = await fs.readFile(result, 'utf-8')

      expect(savedHtml).toBe(simpleHtml)
    })

    // Test 6: Resource download errors
    it('should handle resource download failures', async () => {
      const htmlWithFailingResource = `
        <html>
          <head>
            <link rel="stylesheet" href="https://example.com/failing.css">
          </head>
          <body>
            <img src="https://example.com/failing.png" alt="failing image">
          </body>
        </html>
      `

      nock('https://example.com')
        .get('/with-resources')
        .reply(200, htmlWithFailingResource)

      // Mock failing CSS - should cause error when downloading resources
      nock('https://example.com')
        .get('/failing.css')
        .reply(404, 'CSS Not Found')

      await expect(load('https://example.com/with-resources', tmpDir))
        .rejects
        .toThrow(/Resource not found \(404\)/)
    })
  })
})
