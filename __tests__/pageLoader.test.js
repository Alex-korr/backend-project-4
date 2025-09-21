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
const expectedFilename = 'ru-hexlet-io-courses.html' // expected filename

describe('pageLoader', () => {
  let tmpDir

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
  })

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
  })
})
