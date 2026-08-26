import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const distDirectory = resolve('dist')
const sourcePrefix = '@/'

async function findJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory()
      ? findJavaScriptFiles(path)
      : entry.isFile() && path.endsWith('.js')
        ? [path]
        : []
  }))

  return files.flat()
}

function createRelativeImportPath(filePath, aliasPath) {
  const targetPath = join(distDirectory, aliasPath)
  let importPath = relative(resolve(filePath, '..'), targetPath).replaceAll('\\', '/')

  if (!importPath.startsWith('.')) {
    importPath = `./${importPath}`
  }

  return importPath.endsWith('.js') ? importPath : `${importPath}.js`
}

const files = await findJavaScriptFiles(distDirectory)

await Promise.all(files.map(async (filePath) => {
  const source = await readFile(filePath, 'utf8')
  const output = source.replaceAll(/(['"])@\/([^'"\n]+)\1/g, (match, quote, aliasPath) => {
    return `${quote}${createRelativeImportPath(filePath, aliasPath)}${quote}`
  })

  if (output !== source) {
    await writeFile(filePath, output)
  }
}))
