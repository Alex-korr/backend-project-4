// src/pageLoader.js
import axios from 'axios'
import * as cheerio from 'cheerio'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, join, extname } from 'node:path'
import debug from 'debug'
import { Listr } from 'listr2'

const log = debug('page-loader')

// Enable axios debug logging
if (debug.enabled('page-loader')) {
  axios.defaults.timeout = 30000
  axios.interceptors.request.use((config) => {
    log('HTTP Request: %s %s', config.method?.toUpperCase() || 'GET', config.url)
    return config
  })

  axios.interceptors.response.use(
    (response) => {
      log('HTTP Response: %d %s (%d bytes)', response.status, response.config.url,
        response.data?.length || response.data?.byteLength || 0)
      return response
    },
    (error) => {
      log('HTTP Error: %s %s - %s',
        error.config?.method?.toUpperCase() || 'GET',
        error.config?.url || 'unknown',
        error.message)
      return Promise.reject(error)
    },
  )
}

const generateFilename = (url) => {
  const urlObj = new URL(url)
  const fullPath = `${urlObj.hostname}${urlObj.pathname}`.replace(/\/$/, '')
  const filename = fullPath.replace(/[^a-zA-Z0-9]/g, '-')
  return `${filename}.html`
}

const generateResourceDirName = (url) => {
  const urlObj = new URL(url)
  const fullPath = `${urlObj.hostname}${urlObj.pathname}`.replace(/\/$/, '')
  const dirName = fullPath.replace(/[^a-zA-Z0-9]/g, '-')
  return `${dirName}_files`
}

const generateResourceFileName = (resourceUrl) => {
  const urlObj = new URL(resourceUrl)
  let fileExtension = extname(urlObj.pathname)

  // If no extension, try to guess from the path or default to .html for canonical links
  if (!fileExtension) {
    // For paths like "/courses" assume it's HTML
    fileExtension = '.html'
  }

  const pathWithoutExtension = urlObj.pathname.replace(fileExtension, '')
  const cleanPath = `${urlObj.hostname}${pathWithoutExtension}`.replace(/[^a-zA-Z0-9]/g, '-')
  return cleanPath + fileExtension
}

const isLocalResource = (resourceUrl, pageUrl) => {
  const resourceHost = new URL(resourceUrl).hostname
  const pageHost = new URL(pageUrl).hostname
  return resourceHost === pageHost
}

const downloadImage = async (imageUrl) => {
  try {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' })
    return response.data
  }
  catch (error) {
    if (error.response?.status === 404) {
      throw new Error(`Image not found (404): ${imageUrl}`)
    }
    if (error.response?.status >= 500) {
      throw new Error(`Server error (${error.response.status}): ${imageUrl}`)
    }
    if (error.code === 'ENOTFOUND') {
      throw new Error(`Cannot resolve hostname for image: ${imageUrl}`)
    }
    throw new Error(`Failed to download image: ${imageUrl} - ${error.message}`)
  }
}

const downloadTextResource = async (resourceUrl) => {
  try {
    const response = await axios.get(resourceUrl)
    return response.data
  }
  catch (error) {
    if (error.response?.status === 404) {
      throw new Error(`Resource not found (404): ${resourceUrl}`)
    }
    if (error.response?.status >= 500) {
      throw new Error(`Server error (${error.response.status}): ${resourceUrl}`)
    }
    if (error.code === 'ENOTFOUND') {
      throw new Error(`Cannot resolve hostname for resource: ${resourceUrl}`)
    }
    throw new Error(`Failed to download resource: ${resourceUrl} - ${error.message}`)
  }
}

const processAllResources = async (html, pageUrl, outputDir) => {
  const baseUrl = new URL(pageUrl)
  const resourceDirName = generateResourceDirName(pageUrl)
  const resourceDir = join(outputDir, resourceDirName)

  // Create directory for resources
  log('Creating resource directory: %s', resourceDir)
  try {
    await mkdir(resourceDir, { recursive: true })
  }
  catch (error) {
    if (error.code === 'EACCES') {
      throw new Error(`Permission denied: Cannot create directory ${resourceDir}`)
    }
    if (error.code === 'ENOSPC') {
      throw new Error(`No space left on device: Cannot create directory ${resourceDir}`)
    }
    throw new Error(`Failed to create directory ${resourceDir}: ${error.message}`)
  }

  // Use cheerio to find resources, but keep original HTML for replacements
  const $ = cheerio.load(html)
  let modifiedHtml = html

  // Process images in parallel
  const images = $('img')
  const imagePromises = []
  log('Found %d images to process', images.length)

  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    const src = $(img).attr('src')

    if (src) {
      const resourceUrl = new URL(src, baseUrl).href

      if (isLocalResource(resourceUrl, pageUrl)) {
        // Create promise for parallel execution
        const imagePromise = (async () => {
          const imageData = await downloadImage(resourceUrl)
          const fileName = generateResourceFileName(resourceUrl)
          const imagePath = join(resourceDir, fileName)
          await writeFile(imagePath, imageData)
          const newSrc = join(resourceDirName, fileName)
          return { src, newSrc }
        })()

        imagePromises.push(imagePromise)
      }
    }
  }

  // Wait for all images to download in parallel with progress
  let imageResults = []
  if (imagePromises.length > 0) {
    log('Starting parallel download of %d images', imagePromises.length)

    // Disable visual progress in test environment
    if (process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test') {
      // In test mode, just use Promise.all without visual progress
      imageResults = await Promise.all(imagePromises)
    }
    else {
      // In normal mode, use listr2 for visual progress
      const imageTasks = imagePromises.map((promise, index) => ({
        title: `Downloading image ${index + 1}`,
        task: () => promise,
      }))

      const imageTaskList = new Listr(imageTasks, {
        concurrent: true,
        rendererOptions: { collapse: false },
      })

      // Run listr for visual progress, but get results from promises
      await imageTaskList.run()
      imageResults = await Promise.all(imagePromises)
    }
  } // Apply all replacements to HTML
  for (const { src, newSrc } of imageResults) {
    modifiedHtml = modifiedHtml.replace(src, newSrc)
  }

  // Process CSS links in parallel
  const links = $('link[rel="stylesheet"]')
  const cssPromises = []
  log('Found %d CSS files to process', links.length)

  for (let i = 0; i < links.length; i++) {
    const link = links[i]
    const href = $(link).attr('href')

    if (href) {
      const resourceUrl = new URL(href, baseUrl).href

      if (isLocalResource(resourceUrl, pageUrl)) {
        // Create promise for parallel execution
        const cssPromise = (async () => {
          const cssData = await downloadTextResource(resourceUrl)
          const fileName = generateResourceFileName(resourceUrl)
          const cssPath = join(resourceDir, fileName)
          await writeFile(cssPath, cssData)
          const newHref = join(resourceDirName, fileName)
          return { href, newHref }
        })()

        cssPromises.push(cssPromise)
      }
    }
  }

  // Wait for all CSS files to download in parallel
  if (cssPromises.length > 0) {
    log('Starting parallel download of %d CSS files', cssPromises.length)
  }
  const cssResults = await Promise.all(cssPromises)

  // Apply all CSS replacements to HTML
  for (const { href, newHref } of cssResults) {
    // Replace the href attribute more precisely to handle the " />" case
    modifiedHtml = modifiedHtml.replace(
      `href="${href}" />`,
      `href="${newHref}">`,
    )
  }

  // Process JS scripts in parallel
  const scripts = $('script[src]')
  const jsPromises = []
  log('Found %d JS files to process', scripts.length)

  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i]
    const src = $(script).attr('src')

    if (src) {
      const resourceUrl = new URL(src, baseUrl).href

      if (isLocalResource(resourceUrl, pageUrl)) {
        // Create promise for parallel execution
        const jsPromise = (async () => {
          const jsData = await downloadTextResource(resourceUrl)
          const fileName = generateResourceFileName(resourceUrl)
          const jsPath = join(resourceDir, fileName)
          await writeFile(jsPath, jsData)
          const newSrc = join(resourceDirName, fileName)
          return { src, newSrc }
        })()

        jsPromises.push(jsPromise)
      }
    }
  }

  // Wait for all JS files to download in parallel
  if (jsPromises.length > 0) {
    log('Starting parallel download of %d JS files', jsPromises.length)
  }
  const jsResults = await Promise.all(jsPromises)

  // Apply all JS replacements to HTML
  for (const { src, newSrc } of jsResults) {
    modifiedHtml = modifiedHtml.replace(src, newSrc)
  }

  // Process canonical links in parallel
  const canonicals = $('link[rel="canonical"]')
  const canonicalPromises = []
  log('Found %d canonical links to process', canonicals.length)

  for (let i = 0; i < canonicals.length; i++) {
    const canonical = canonicals[i]
    const href = $(canonical).attr('href')

    if (href) {
      const resourceUrl = new URL(href, baseUrl).href

      if (isLocalResource(resourceUrl, pageUrl)) {
        // Create promise for parallel execution
        const canonicalPromise = (async () => {
          const htmlData = await downloadTextResource(resourceUrl)
          const fileName = generateResourceFileName(resourceUrl)
          const htmlPath = join(resourceDir, fileName)
          await writeFile(htmlPath, htmlData)
          const newHref = join(resourceDirName, fileName)
          return { href, newHref }
        })()

        canonicalPromises.push(canonicalPromise)
      }
    }
  }

  // Wait for all canonical links to download in parallel
  if (canonicalPromises.length > 0) {
    log('Starting parallel download of %d canonical links', canonicalPromises.length)
  }
  const canonicalResults = await Promise.all(canonicalPromises)

  // Apply all canonical replacements to HTML
  for (const { href, newHref } of canonicalResults) {
    modifiedHtml = modifiedHtml.replace(href, newHref)
  }

  const totalResources = imageResults.length + cssResults.length + jsResults.length + canonicalResults.length
  log('All resources processed successfully: %d total', totalResources)

  return modifiedHtml
}

const load = async (url, outputDir) => {
  log('Starting page load: %s', url)
  log('Output directory: %s', outputDir)

  const filename = generateFilename(url)
  const filepath = resolve(outputDir, filename)

  // Download HTML
  log('Loading page content...')
  let response, html
  try {
    response = await axios.get(url)
    html = response.data
    log('Page loaded successfully, size: %d bytes', html.length)
  }
  catch (error) {
    if (error.response?.status === 404) {
      throw new Error(`Page not found (404): ${url}`)
    }
    if (error.response?.status === 403) {
      throw new Error(`Access forbidden (403): ${url}`)
    }
    if (error.response?.status >= 500) {
      throw new Error(`Server error (${error.response.status}): ${url}`)
    }
    if (error.code === 'ENOTFOUND') {
      throw new Error(`Cannot resolve hostname: ${url}`)
    }
    if (error.code === 'ECONNREFUSED') {
      throw new Error(`Connection refused: ${url}`)
    }
    if (error.code === 'ETIMEDOUT') {
      throw new Error(`Request timeout: ${url}`)
    }
    throw new Error(`Network error: ${url} - ${error.message}`)
  }

  // Check if there are any resources in HTML
  const hasResources = html.includes('<img') || html.includes('<link') || html.includes('<script')
  log('Parsing HTML content')

  let processedHtml
  if (hasResources) {
    log('Resources found in HTML, starting resource processing')
    // Process all resources
    processedHtml = await processAllResources(html, url, outputDir)
  }
  else {
    log('No resources found in HTML')
    // Leave HTML as is
    processedHtml = html
  }

  // Save processed HTML
  log('Saving processed HTML to: %s', filepath)
  try {
    await writeFile(filepath, processedHtml)
    log('Operation completed successfully')
  }
  catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Directory not found: ${outputDir}`)
    }
    if (error.code === 'EACCES') {
      throw new Error(`Permission denied: Cannot write to ${filepath}`)
    }
    if (error.code === 'ENOSPC') {
      throw new Error(`No space left on device: ${filepath}`)
    }
    throw new Error(`File system error: ${error.message}`)
  }

  return filepath
}

export default load
