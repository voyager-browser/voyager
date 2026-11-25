'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { commandLines } = require('./validate-workflows')

function summarize(commands) {
  return commands.map(({ line, text }) => ({ line, text: text.trim() }))
}

test('collects continuation lines of a plain multiline run value', () => {
  const commands = commandLines(
    [
      'jobs:',
      '  release:',
      '    steps:',
      '      - run: echo',
      '          "${{ github.ref_name }}"',
      '        env:',
      '          TAG: ${{ github.ref_name }}'
    ].join('\n')
  )

  assert.deepEqual(summarize(commands), [
    { line: 4, text: '- run: echo' },
    { line: 5, text: '"${{ github.ref_name }}"' }
  ])
})

test('stops a block run value before a sibling env section', () => {
  const commands = commandLines(
    [
      'jobs:',
      '  release:',
      '    steps:',
      '      - run: |',
      '          echo safe',
      '        env:',
      '          TAG: ${{ github.ref_name }}'
    ].join('\n')
  )

  assert.deepEqual(summarize(commands), [{ line: 5, text: 'echo safe' }])
})
