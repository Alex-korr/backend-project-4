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

  // Test 3: Download page with local resources
  it('should download page with local resources and modify links', async () => {
    const htmlWithResources = `<!DOCTYPE html>
<html>
<head>
  <title>Test Page</title>
  <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
  <img src="/images/logo.png" alt="Logo">
  <script src="/js/app.js"></script>
</body>
</html>`

    const cssContent = 'body { color: blue; }'
    const jsContent = 'console.log("Hello");'
    const imageBuffer = Buffer.from('fake-png-data')

    // Mock main page
    nock('https://example.com')
      .get('/test')
      .reply(200, htmlWithResources)

    // Mock resources
    nock('https://example.com')
      .get('/assets/style.css')
      .reply(200, cssContent)
      .get('/js/app.js')
      .reply(200, jsContent)
      .get('/images/logo.png')
      .reply(200, imageBuffer)

    const result = await load('https://example.com/test', tmpDir)

    // Check that HTML file was created and links were modified
    const savedHtml = await fs.readFile(result, 'utf-8')
    expect(savedHtml).toContain('example-com-test_files')

    // Check that resources directory was created
    const resourcesDir = path.join(tmpDir, 'example-com-test_files')
    await expect(fs.stat(resourcesDir)).resolves.toHaveProperty('isDirectory')

    // Check that resources were downloaded
    const cssFile = path.join(resourcesDir, 'example-com-assets-style.css')
    const jsFile = path.join(resourcesDir, 'example-com-js-app.js')
    const imgFile = path.join(resourcesDir, 'example-com-images-logo.png')

    await expect(fs.stat(cssFile)).resolves.toHaveProperty('size')
    await expect(fs.stat(jsFile)).resolves.toHaveProperty('size')
    await expect(fs.stat(imgFile)).resolves.toHaveProperty('size')
  }, 15000)

  // Test 4: Handle server errors
  it('should handle server errors (500)', async () => {
    nock('https://example.com')
      .get('/error')
      .reply(500, 'Internal Server Error')

    await expect(load('https://example.com/error', tmpDir))
      .rejects
      .toThrow('Server error (500): https://example.com/error')
  })

  // Test 5: Handle resource download errors
  it('should handle resource download failures gracefully', async () => {
    const htmlWithBrokenResource = `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="/broken.css">
</head>
<body>
  <h1>Test</h1>
</body>
</html>`

    // Mock main page
    nock('https://example.com')
      .get('/test')
      .reply(200, htmlWithBrokenResource)

    // Mock failing resource
    nock('https://example.com')
      .get('/broken.css')
      .reply(404, 'Not Found')

    // This should throw an error when trying to download the broken resource
    await expect(load('https://example.com/test', tmpDir))
      .rejects
      .toThrow('Resource not found (404)')
  })

  // Test 6: Handle HTML with mixed external and local resources
  it('should only download local resources, ignore external ones', async () => {
    const htmlWithMixedResources = `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://external.com/style.css">
  <link rel="stylesheet" href="/local/style.css">
</head>
<body>
  <img src="https://external.com/logo.png" alt="External">
  <img src="/local/image.png" alt="Local">
</body>
</html>`

    const localCss = 'body { margin: 0; }'
    const localImg = Buffer.from('local-image-data')

    // Mock main page
    nock('https://example.com')
      .get('/mixed')
      .reply(200, htmlWithMixedResources)

    // Mock only local resources
    nock('https://example.com')
      .get('/local/style.css')
      .reply(200, localCss)
      .get('/local/image.png')
      .reply(200, localImg)

    const result = await load('https://example.com/mixed', tmpDir)
    const savedHtml = await fs.readFile(result, 'utf-8')

    // External links should remain unchanged
    expect(savedHtml).toContain('https://external.com/style.css')
    expect(savedHtml).toContain('https://external.com/logo.png')

    // Local links should be modified
    expect(savedHtml).toContain('example-com-mixed_files')
  })

  // Test 7: Simple test to cover additional error paths
  it('should handle 403 forbidden error', async () => {
    nock('https://example.com')
      .get('/forbidden')
      .reply(403, 'Forbidden')

    await expect(load('https://example.com/forbidden', tmpDir))
      .rejects
      .toThrow('Access forbidden (403): https://example.com/forbidden')
  })

  // Test 8: Test HTML without resources (else branch)
  it('should handle HTML without any resources', async () => {
    const simpleHtml = '<html><body><h1>No resources here</h1></body></html>'

    nock('https://example.com')
      .get('/simple')
      .reply(200, simpleHtml)

    const result = await load('https://example.com/simple', tmpDir)
    const savedHtml = await fs.readFile(result, 'utf-8')

    expect(savedHtml).toBe(simpleHtml)

    // Should not create resources directory
    const resourcesDir = path.join(tmpDir, 'example-com-simple_files')
    await expect(fs.stat(resourcesDir)).rejects.toThrow()
  })

  // Test 9: Test file system errors with non-existent directory
  it('should handle file system errors when output directory does not exist', async () => {
    const htmlWithResources = `<!DOCTYPE html>
<html>
<body>
  <img src="/test.jpg" alt="test">
</body>
</html>`

    nock('https://example.com')
      .get('/test')
      .reply(200, htmlWithResources)

    // Try to save to completely non-existent path (should fail due to permissions)
    await expect(load('https://example.com/test', '/completely/non/existent/path'))
      .rejects
      .toThrow('ENOENT')
  })
})
