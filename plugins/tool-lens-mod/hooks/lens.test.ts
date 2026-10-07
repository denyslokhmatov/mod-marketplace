import { expect, test } from 'claude-code/testing'

import { classify, counts, describe, fmtMs, sizeOf } from './lens'

test('classifies tools into human categories', () => {
  expect(classify('Read')).toBe('read')
  expect(classify('Grep')).toBe('search')
  expect(classify('Skill')).toBe('skill')
  expect(classify('mcp__abc__jira_get_issue')).toBe('app')
  expect(classify('Agent')).toBe('agent')
})

test('describes calls in plain language', () => {
  expect(describe('Read', { file_path: '/a/src/routes.ts' }).title).toBe('Read routes.ts')
  expect(describe('mcp__370a5e26-f945-4827-b1f5-048a4fe007d5__jira_get_issue', { issue_key: 'PROJ-482' }).detail).toBe('jira · get_issue PROJ-482')
  expect(describe('Bash', { command: 'npm test', description: 'Ran the tests' }).title).toBe('Ran the tests')
})

test('formats time, size and counts', () => {
  expect(fmtMs(400)).toBe('0.4 s')
  expect(fmtMs(102000)).toBe('1 min 42 s')
  expect(sizeOf(100)).toBe('small')
  expect(sizeOf(50000)).toBe('large')
  expect(counts([]).length).toBe(0)
})

test('named servers supply the app', () => {
  expect(describe('mcp__visualize__read_me', {}).title).toBe('Visualize: read me')
})
