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
  const filename = fullPath.replaceAll(/[^a-zA-Z0-9]/g, '-')
  return `${filename}.html`
}

const generateResourceDirName = (url) => {
  const urlObj = new URL(url)
  const fullPath = `${urlObj.hostname}${urlObj.pathname}`.replace(/\/$/, '')
  const dirName = fullPath.replaceAll(/[^a-zA-Z0-9]/g, '-')
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
  const cleanPath = `${urlObj.hostname}${pathWithoutExtension}`.replaceAll(/[^a-zA-Z0-9]/g, '-')
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

const createResourceDirectory = async (resourceDir) => {
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
}

const processResourceType = async ($, selector, attrName, resourceDir, resourceDirName, baseUrl, pageUrl, downloadFn) => {
  const elements = selector
  const promises = []
  log('Found %d %s to process', elements.length, attrName)

  for (const element of elements) {
    const attr = $(element).attr(attrName)

    if (attr) {
      const resourceUrl = new URL(attr, baseUrl).href

      if (isLocalResource(resourceUrl, pageUrl)) {
        const promise = (async () => {
          const data = await downloadFn(resourceUrl)
          const fileName = generateResourceFileName(resourceUrl)
          const resourcePath = join(resourceDir, fileName)
          await writeFile(resourcePath, data)
          const newAttr = join(resourceDirName, fileName)
          return { oldAttr: attr, newAttr }
        })()

        promises.push(promise)
      }
    }
  }

  if (promises.length > 0) {
    log('Starting parallel download of %d %s', promises.length, attrName)
  }

  return Promise.all(promises)
}

const processImages = async ($, resourceDir, resourceDirName, baseUrl, pageUrl) => {
  const images = $('img')
  const imagePromises = []

  for (const img of images) {
    const src = $(img).attr('src')

    if (src) {
      const resourceUrl = new URL(src, baseUrl).href

      if (isLocalResource(resourceUrl, pageUrl)) {
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

  // Handle visual progress only for images (the most visible part)
  let imageResults = []
  if (imagePromises.length > 0) {
    log('Starting parallel download of %d images', imagePromises.length)

    // Disable visual progress in test environment
    if (process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test') {
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

      await imageTaskList.run()
      imageResults = await Promise.all(imagePromises)
    }
  }

  return imageResults
}

const processAllResources = async (html, pageUrl, outputDir) => {
  const baseUrl = new URL(pageUrl)
  const resourceDirName = generateResourceDirName(pageUrl)
  const resourceDir = join(outputDir, resourceDirName)

  await createResourceDirectory(resourceDir)

  // Use cheerio to find resources, but keep original HTML for replacements
  const $ = cheerio.load(html)
  let modifiedHtml = html

  // Process each type of resource
  const imageResults = await processImages($, resourceDir, resourceDirName, baseUrl, pageUrl)
  const cssResults = await processResourceType($, $('link[rel="stylesheet"]'), 'href', resourceDir, resourceDirName, baseUrl, pageUrl, downloadTextResource)
  const jsResults = await processResourceType($, $('script[src]'), 'src', resourceDir, resourceDirName, baseUrl, pageUrl, downloadTextResource)
  const canonicalResults = await processResourceType($, $('link[rel="canonical"]'), 'href', resourceDir, resourceDirName, baseUrl, pageUrl, downloadTextResource)

  // Apply all replacements to HTML
  for (const { src, newSrc } of imageResults) {
    modifiedHtml = modifiedHtml.replace(src, newSrc)
  }

  for (const { oldAttr, newAttr } of cssResults) {
    modifiedHtml = modifiedHtml.replace(`href="${oldAttr}" />`, `href="${newAttr}">`)
  }

  for (const { oldAttr, newAttr } of jsResults) {
    modifiedHtml = modifiedHtml.replace(oldAttr, newAttr)
  }

  for (const { oldAttr, newAttr } of canonicalResults) {
    modifiedHtml = modifiedHtml.replace(oldAttr, newAttr)
  }

  const totalResources = imageResults.length + cssResults.length + jsResults.length + canonicalResults.length
  log('All resources processed successfully: %d total', totalResources)

  return modifiedHtml
}

const downloadPageContent = async (url) => {
  log('Loading page content...')
  try {
    const response = await axios.get(url)
    const html = response.data
    log('Page loaded successfully, size: %d bytes', html.length)
    return html
  }
  catch (error) {
    if (error.response?.status === 403) {
      throw new Error(`Access forbidden (403): ${url}`)
    }
    if (error.response?.status === 404) {
      throw new Error(`Page not found (404): ${url}`)
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
}

const saveProcessedHtml = async (filepath, processedHtml, outputDir) => {
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
}

const load = async (url, outputDir) => {
  log('Starting page load: %s', url)
  log('Output directory: %s', outputDir)

  const filename = generateFilename(url)
  const filepath = resolve(outputDir, filename)

  // Download HTML
  const html = await downloadPageContent(url)

  // Check if there are any resources in HTML and process accordingly
  const hasResources = html.includes('<img') || html.includes('<link') || html.includes('<script')
  log('Parsing HTML content')

  let processedHtml
  if (hasResources) {
    log('Resources found in HTML, starting resource processing')
    processedHtml = await processAllResources(html, url, outputDir)
  }
  else {
    log('No resources found in HTML')
    processedHtml = html
  }

  // Save processed HTML
  await saveProcessedHtml(filepath, processedHtml, outputDir)

  return filepath
}

export default load
