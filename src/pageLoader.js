// src/pageLoader.js
import axios from 'axios'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const generateFilename = (url) => {
  const urlObj = new URL(url)
  const fullPath = `${urlObj.hostname}${urlObj.pathname}`.replace(/\/$/, '')
  const filename = fullPath.replace(/[^a-zA-Z0-9]/g, '-')
  return `${filename}.html`
}

const load = (url, outputDir) => {
  const filename = generateFilename(url)
  const filepath = resolve(outputDir, filename)

  return axios.get(url)
    .then(response => response.data)
    .then(html => writeFile(filepath, html))
    .then(() => filepath)
}

export default load
