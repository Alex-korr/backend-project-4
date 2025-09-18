import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import nock from 'nock'
import load from '../src/pageLoader.js'

// Получаем __dirname в ES-модулях
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Утилиты для работы с фикстурами
const getFixturePath = filename => path.join(__dirname, '__fixtures__', filename)
const readFixture = async (filename) => {
  const content = await fs.readFile(getFixturePath(filename), 'utf-8')
  return content.trim() // убираем лишние пробелы/переносы
}

// URL, который будем тестировать
const url = 'https://ru.hexlet.io/courses'
const expectedFilename = 'ru-hexlet-io-courses.html' // ожидаемое имя файла

describe('pageLoader', () => {
  let tmpDir

  // Подменяем ответ сервера ДО всех тестов
  beforeAll(async () => {
    const pageContent = await readFixture('expected.html')
    nock('https://ru.hexlet.io')
      .get('/courses')
      .reply(200, pageContent)
  })

  // Перед каждым тестом создаём новую временную папку
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'page-loader-'))
  })

  // После каждого теста удаляем папку
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  // Сам тест
  it('should download page and save to output directory', async () => {
    const outputPath = path.join(tmpDir, expectedFilename)
    const resultPath = await load(url, tmpDir)

    // Проверяем, что функция вернула правильный путь
    expect(resultPath).toBe(outputPath)

    // Проверяем, что файл действительно создался
    await expect(fs.stat(outputPath)).resolves.toHaveProperty('size')

    // Проверяем, что содержимое совпадает с фикстурой
    const savedContent = await fs.readFile(outputPath, 'utf-8')
    const fixtureContent = await readFixture('expected.html')
    expect(savedContent.trim()).toBe(fixtureContent)
  })
})
