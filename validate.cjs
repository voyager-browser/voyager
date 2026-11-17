const fs = require('node:fs')
const path = require('node:path')
const js = require('@eslint/js')
const { ESLint } = require('eslint')
const { HtmlValidate } = require('html-validate')
const postcss = require('postcss')

const root = __dirname
const problems = []

async function validateHtml() {
  const engine = new HtmlValidate()
  const report = await engine.validateFile(path.join(root, 'index.html'))
  for (const result of report.results) {
    for (const message of result.messages) {
      if (message.severity === 2) {
        problems.push(
          `HTML ${message.line}:${message.column} ${message.ruleId}: ${message.message}`
        )
      }
    }
  }
}

function validateCss() {
  try {
    postcss.parse(fs.readFileSync(path.join(root, 'styles.css'), 'utf8'), {
      from: 'styles.css'
    })
  } catch (error) {
    problems.push(`CSS ${error.line}:${error.column} ${error.reason || error.message}`)
  }
}

async function validateJs() {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      js.configs.recommended,
      {
        files: ['script.js'],
        languageOptions: {
          ecmaVersion: 2022,
          sourceType: 'script',
          globals: {
            window: 'readonly',
            document: 'readonly',
            IntersectionObserver: 'readonly'
          }
        }
      }
    ]
  })

  const results = await eslint.lintFiles(['script.js'])
  const formatter = await eslint.loadFormatter('stylish')
  const output = formatter.format(results)
  if (output.trim()) process.stdout.write(`${output}\n`)

  for (const result of results) {
    for (const message of result.messages) {
      if (message.severity === 2) {
        problems.push(
          `JS ${message.line}:${message.column} ${message.ruleId}: ${message.message}`
        )
      }
    }
  }
}

async function main() {
  await validateHtml()
  validateCss()
  await validateJs()

  if (problems.length > 0) {
    console.error(`Validation failed with ${problems.length} error(s):`)
    problems.forEach((problem) => console.error(` - ${problem}`))
    process.exit(1)
  }

  console.log('HTML, CSS, and JS validation passed with no errors.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
