'use strict'

const fs = require('fs')
const path = require('path')

const WORKFLOWS_DIR = path.join(__dirname, '..', 'workflows')
const RUN_LINE = /^\s*(?:-\s*)?run:/
const RUN_BLOCK = /^\s*(?:-\s*)?run:\s*[|>][-+]?/
const GITHUB_EXPRESSION = /\$\{\{\s*github\./

function workflowFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return workflowFiles(entryPath)
    if (entry.isFile() && /\.ya?ml$/.test(entry.name)) return [entryPath]
    return []
  })
}

function commandLines(content) {
  const commands = []
  let blockIndent = null

  content.split(/\r?\n/).forEach((line, index) => {
    const indent = line.length - line.trimStart().length

    if (blockIndent !== null) {
      if (line.trim() === '' || indent > blockIndent) {
        commands.push({ line: index + 1, text: line })
        return
      }
      blockIndent = null
    }

    if (RUN_BLOCK.test(line)) {
      blockIndent = indent
      return
    }
    if (RUN_LINE.test(line)) commands.push({ line: index + 1, text: line })
  })

  return commands
}

function validate(directory) {
  const violations = []

  for (const file of workflowFiles(directory)) {
    const relativePath = path.relative(process.cwd(), file)
    for (const command of commandLines(fs.readFileSync(file, 'utf8'))) {
      if (GITHUB_EXPRESSION.test(command.text)) {
        violations.push(
          `${relativePath}:${command.line}: pass GitHub expressions through env, not shell source`
        )
      }
    }
  }

  return violations
}

function main() {
  const violations = validate(WORKFLOWS_DIR)

  if (violations.length > 0) {
    console.error(`Invalid workflow shell commands:\n${violations.map((v) => `  ${v}`).join('\n')}`)
    process.exitCode = 1
  }
}

if (require.main === module) main()

module.exports = { commandLines, validate }
