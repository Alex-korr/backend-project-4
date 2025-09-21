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
  const fileExtension = extname(urlObj.pathname) || '.png'
  const pathWithoutExtension = urlObj.pathname.replace(fileExtension, '')
  const cleanPath = `${urlObj.hostname}${pathWithoutExtension}`.replace(/[^a-zA-Z0-9]/g, '-')
  return cleanPath + fileExtension
}

const downloadImage = async (imageUrl) => {
  const response = await axios.get(imageUrl, { responseType: 'arraybuffer' })
  return response.data
}

const processImagesInHtml = async (html, pageUrl, outputDir) => {
  const baseUrl = new URL(pageUrl)
  const resourceDirName = generateResourceDirName(pageUrl)
  const resourceDir = join(outputDir, resourceDirName)

  // Create directory for resources
  await mkdir(resourceDir, { recursive: true })

  // Use cheerio only to find images
  const $ = cheerio.load(html)
  const images = $('img')

  let modifiedHtml = html

  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    const src = $(img).attr('src')

    if (src) {
      // Create full image URL
      const imageUrl = new URL(src, baseUrl).href

      // Download image
      const imageData = await downloadImage(imageUrl)

      // Create filename
      const fileName = generateResourceFileName(imageUrl)
      const imagePath = join(resourceDir, fileName)

      // Save image
      await writeFile(imagePath, imageData)

      // Replace src in HTML using replace
      const newSrc = join(resourceDirName, fileName)
      modifiedHtml = modifiedHtml.replace(src, newSrc)
    }
  }

  return modifiedHtml
}

const load = async (url, outputDir) => {
  const filename = generateFilename(url)
  const filepath = resolve(outputDir, filename)

  // Download HTML
  const response = await axios.get(url)
  const html = response.data

  // Check if there are images in HTML
  const hasImages = html.includes('<img')

  let processedHtml
  if (hasImages) {
    // Process images
    processedHtml = await processImagesInHtml(html, url, outputDir)
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
