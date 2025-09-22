// src/pageLoader.js
import axios from 'axios'
import * as cheerio from 'cheerio'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, join, extname } from 'node:path'

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
  const response = await axios.get(imageUrl, { responseType: 'arraybuffer' })
  return response.data
}

const downloadTextResource = async (resourceUrl) => {
  const response = await axios.get(resourceUrl)
  return response.data
}

const processAllResources = async (html, pageUrl, outputDir) => {
  const baseUrl = new URL(pageUrl)
  const resourceDirName = generateResourceDirName(pageUrl)
  const resourceDir = join(outputDir, resourceDirName)

  // Create directory for resources
  await mkdir(resourceDir, { recursive: true })

  // Use cheerio to find resources, but keep original HTML for replacements
  const $ = cheerio.load(html)
  let modifiedHtml = html

  // Process images in parallel
  const images = $('img')
  const imagePromises = []

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

  // Wait for all images to download in parallel
  const imageResults = await Promise.all(imagePromises)

  // Apply all replacements to HTML
  for (const { src, newSrc } of imageResults) {
    modifiedHtml = modifiedHtml.replace(src, newSrc)
  }

  // Process CSS links in parallel
  const links = $('link[rel="stylesheet"]')
  const cssPromises = []

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
  const jsResults = await Promise.all(jsPromises)

  // Apply all JS replacements to HTML
  for (const { src, newSrc } of jsResults) {
    modifiedHtml = modifiedHtml.replace(src, newSrc)
  }

  // Process canonical links in parallel
  const canonicals = $('link[rel="canonical"]')
  const canonicalPromises = []

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
  const canonicalResults = await Promise.all(canonicalPromises)

  // Apply all canonical replacements to HTML
  for (const { href, newHref } of canonicalResults) {
    modifiedHtml = modifiedHtml.replace(href, newHref)
  }

  return modifiedHtml
}

const load = async (url, outputDir) => {
  const filename = generateFilename(url)
  const filepath = resolve(outputDir, filename)

  // Download HTML
  const response = await axios.get(url)
  const html = response.data

  // Check if there are any resources in HTML
  const hasResources = html.includes('<img') || html.includes('<link') || html.includes('<script')

  let processedHtml
  if (hasResources) {
    // Process all resources
    processedHtml = await processAllResources(html, url, outputDir)
  }
  else {
    // Leave HTML as is
    processedHtml = html
  }

  // Save processed HTML
  await writeFile(filepath, processedHtml)

  return filepath
}

export default load
