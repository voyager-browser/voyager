'use strict'

const fs = require('fs')
const path = require('path')

const WORKFLOWS_DIR = path.join(__dirname, '..', 'workflows')
const RUN_KEY = /^(?:-\s+)?run:\s*(.*)$/
const BLOCK_SCALAR = /^[|>][1-9]?[+-]?$|^[|>][+-]?[1-9]?$/
const GITHUB_EXPRESSION = /\$\{\{\s*github\./

function workflowFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return workflowFiles(entryPath)
    if (entry.isFile() && /\.ya?ml$/.test(entry.name)) return [entryPath]
    return []
  })
}

function indentation(line) {
  return line.length - line.trimStart().length
}

function isBlank(line) {
  return line.trim() === ''
}

/**
 * Column where the `run` key starts. For `- run:` the dash is not part of the
 * key, so sibling keys such as `env:` align after the dash and space.
 */
function keyIndent(line) {
  const indent = indentation(line)
  const dash = line.trimStart().match(/^-\s+/)
  return dash ? indent + dash[0].length : indent
}

function blockContentIndent(lines, start, parentIndent) {
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]
    if (isBlank(line)) continue
    const indent = indentation(line)
    if (indent <= parentIndent) return null
    return indent
  }
  return null
}

/**
 * Return every line that is part of a workflow `run` value. Block scalars end
 * at the first line dedented below their content, while plain scalars include
 * every more-indented continuation line. Either way, sibling `env:` keys are
 * never mistaken for shell source.
 */
function commandLines(content) {
  const lines = content.split(/\r?\n/)
  const commands = []

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].trimStart().match(RUN_KEY)
    if (!match) continue

    const indent = keyIndent(lines[index])
    const value = match[1].trim()

    if (BLOCK_SCALAR.test(value)) {
      const contentIndent = blockContentIndent(lines, index + 1, indent)
      if (contentIndent === null) continue

      let cursor = index + 1
      while (cursor < lines.length) {
        const line = lines[cursor]
        if (!isBlank(line) && indentation(line) < contentIndent) break
        commands.push({ line: cursor + 1, text: line })
        cursor += 1
      }
      index = cursor - 1
      continue
    }

    if (value === '') continue

    commands.push({ line: index + 1, text: lines[index] })

    let cursor = index + 1
    while (cursor < lines.length) {
      const line = lines[cursor]
      if (!isBlank(line) && indentation(line) <= indent) break
      commands.push({ line: cursor + 1, text: line })
      cursor += 1
    }
    index = cursor - 1
  }

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
