'use strict'

const DEFAULT_REPO = 'voyager-browser/voyager'

const FEATURE_TYPES = new Set(['feat'])
const IMPROVEMENT_TYPES = new Set(['refactor', 'perf', 'style', 'test', 'docs'])
const FIX_TYPES = new Set(['fix'])
const OTHER_TYPES = new Set(['ops', 'chore', 'build'])

function parseArgs(argv) {
  const options = {
    from: null,
    tag: null,
    to: null,
    output: null,
    repository: process.env.GITHUB_REPOSITORY || process.env.GITHUB_REPO || DEFAULT_REPO
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--from') {
      options.from = argv[++i]
    } else if (arg === '--to') {
      options.to = argv[++i]
    } else if (arg === '--output' || arg === '-o') {
      options.output = argv[++i]
    } else if (arg === '--repo' || arg === '--repository') {
      options.repository = argv[++i]
    } else if (arg === '--stdout') {
      options.output = '-'
    } else if (arg.startsWith('--from=')) {
      options.from = arg.slice('--from='.length)
    } else if (arg.startsWith('--to=')) {
      options.to = arg.slice('--to='.length)
    } else if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length)
    } else if (!options.tag) {
      options.tag = arg
    } else if (!options.output) {
      options.output = arg
    } else {
      throw new Error(`Unexpected argument: ${arg}`)
    }
  }

  if (!options.tag) {
    options.tag = process.env.GITHUB_REF_NAME || process.env.TAG || process.env.RELEASE_TAG || null
  }
  if (!options.to) {
    options.to = options.tag
  }
  if (!options.tag) {
    throw new Error(
      'A release tag is required (pass it as the first argument or set GITHUB_REF_NAME)'
    )
  }
  return options
}

function tokenFromEnvironment() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PAT || null
}

function repositoryParts(repository) {
  const [owner, name] = String(repository).split('/')
  if (!owner || !name) {
    throw new Error(`Invalid repository: ${repository}`)
  }
  return { owner, name }
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'voyager-release-notes-generator',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }
}

async function githubFetch(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: githubHeaders(token)
  })

  let body
  const text = await response.text()
  try {
    body = text ? JSON.parse(text) : null
  } catch (error) {
    body = text
  }

  if (!response.ok) {
    const message = typeof body === 'object' && body && body.message ? body.message : text
    throw new Error(`GitHub request failed (${response.status}) for ${path}: ${message}`)
  }
  return body
}

async function githubFetchPaginated(pathFactory, token) {
  const results = []
  for (let page = 1; ; page += 1) {
    const pageResults = await githubFetch(pathFactory(page), token)
    if (!Array.isArray(pageResults)) {
      return pageResults
    }
    results.push(...pageResults)
    if (pageResults.length < 100) {
      break
    }
  }
  return results
}

async function resolveTagCommitSha(repository, tag, token) {
  const { owner, name } = repositoryParts(repository)
  const commit = await githubFetch(
    `/repos/${owner}/${name}/commits/${encodeURIComponent(tag)}`,
    token
  )
  return commit && commit.sha ? commit.sha : null
}

/**
 * Read the annotated tag message created alongside the tag (for example with
 * `git tag -a v1.2.3 -m "..."` or lazygit's tag description prompt). Lightweight
 * tags have no message, so this returns null for them.
 */
async function fetchTagDescription(repository, tag, token) {
  const { owner, name } = repositoryParts(repository)

  try {
    const ref = await githubFetch(
      `/repos/${owner}/${name}/git/ref/tags/${encodeURIComponent(tag)}`,
      token
    )
    if (!ref || !ref.object || ref.object.type !== 'tag' || !ref.object.sha) {
      return null
    }
    const annotated = await githubFetch(`/repos/${owner}/${name}/git/tags/${ref.object.sha}`, token)
    if (!annotated || typeof annotated.message !== 'string') {
      return null
    }
    const description = annotated.message.trim()
    return description || null
  } catch (error) {
    // A missing tag ref (or an API hiccup) should not stop the release.
    return null
  }
}

async function getCommitsForRange(repository, previousTag, currentTag, token) {
  const previousCommitSha = previousTag
    ? await resolveTagCommitSha(repository, previousTag, token)
    : null
  const commitsNewestFirst = []

  for (let page = 1; ; page += 1) {
    const { owner, name } = repositoryParts(repository)
    const pageResults = await githubFetch(
      `/repos/${owner}/${name}/commits?sha=${encodeURIComponent(currentTag)}&per_page=100&page=${page}`,
      token
    )
    if (!Array.isArray(pageResults) || pageResults.length === 0) {
      break
    }

    let reachedPrevious = false
    for (const commit of pageResults) {
      if (previousCommitSha && commit.sha === previousCommitSha) {
        reachedPrevious = true
        break
      }
      commitsNewestFirst.push(commit)
    }

    if (reachedPrevious || pageResults.length < 100) {
      break
    }
  }

  return commitsNewestFirst.reverse()
}

async function findPreviousTag(repository, currentTag, token) {
  const { owner, name } = repositoryParts(repository)

  // Prefer the newest published release: it is the well-defined previous cut.
  try {
    const releases = await githubFetchPaginated(
      (page) => `/repos/${owner}/${name}/releases?per_page=100&page=${page}`,
      token
    )
    const previous = releases
      .filter((release) => release && release.tag_name && release.tag_name !== currentTag)
      .sort(
        (a, b) =>
          Date.parse(b.created_at || b.published_at || '') -
          Date.parse(a.created_at || a.published_at || '')
      )
    if (previous.length > 0) {
      return previous[0].tag_name
    }
  } catch (error) {
    // Fall through to the tags endpoint for repositories without a releases API response.
  }

  try {
    const tags = await githubFetchPaginated(
      (page) => `/repos/${owner}/${name}/tags?per_page=100&page=${page}`,
      token
    )
    if (!Array.isArray(tags) || tags.length === 0) {
      return null
    }

    const currentIndex = tags.findIndex((tag) => tag && tag.name === currentTag)
    if (currentIndex >= 0 && currentIndex < tags.length - 1) {
      return tags[currentIndex + 1].name
    }
    if (currentIndex === -1) {
      return tags[0].name === currentTag ? null : tags[0].name
    }
    return null
  } catch (error) {
    return null
  }
}

function associatedPullsPath(owner, name, sha) {
  return `/repos/${owner}/${name}/commits/${sha}/pulls?per_page=100`
}

function firstAssociatedPull(pulls, commitSha) {
  if (!Array.isArray(pulls) || pulls.length === 0) {
    return null
  }
  const mergedForCommit = pulls.find((pull) => pull && pull.merge_commit_sha === commitSha)
  if (mergedForCommit) {
    return mergedForCommit
  }
  const merged = pulls.find((pull) => pull && pull.merged_at)
  return merged || pulls[0]
}

function parseConventionalSubject(subject) {
  const match = String(subject || '')
    .trim()
    .match(/^(\w+)(?:\(([^)]*)\))?(!)?\s*:\s*(.+)$/)
  if (!match) {
    return null
  }
  return {
    type: match[1].toLowerCase(),
    scope: match[2] ? match[2].trim() : null,
    breaking: Boolean(match[3]),
    message: match[4].trim()
  }
}

function shortSha(sha) {
  return String(sha || '').slice(0, 7)
}

function categoryName(type) {
  if (FEATURE_TYPES.has(type)) return 'features'
  if (IMPROVEMENT_TYPES.has(type)) return 'improvements'
  if (FIX_TYPES.has(type)) return 'fixes'
  if (OTHER_TYPES.has(type)) return 'other'
  return null
}

function renderGroupLine(group) {
  const parsed =
    parseConventionalSubject(group.subject) || parseConventionalSubject(group.commitSubject)
  if (!parsed) {
    return null
  }
  const category = categoryName(parsed.type)
  if (!category) {
    return null
  }

  const head = parsed.scope ? `${parsed.type}(${parsed.scope})` : parsed.type

  const parts = [`- ${head}: ${parsed.message}`]
  if (group.author) {
    parts[parts.length - 1] += ` (@${group.author})`
  }
  if (group.prNumber) {
    parts[parts.length - 1] += ` (#${group.prNumber})`
  }
  const commitList = group.commits.map(shortSha).join(', ')
  parts[parts.length - 1] += ` (${commitList})`

  return { category, text: parts[0] }
}

async function collectReleaseGroups(options) {
  const token = tokenFromEnvironment()
  const previousTag = options.from || (await findPreviousTag(options.repository, options.to, token))
  const commits = await getCommitsForRange(options.repository, previousTag, options.to, token)

  const { owner, name } = repositoryParts(options.repository)
  const groups = new Map()

  for (const commit of commits) {
    const sha = commit.sha
    const commitSubject = String((commit.commit && commit.commit.message) || '')
      .split(/\r?\n/)[0]
      .trim()
    const commitAuthorLogin = commit.author && commit.author.login ? commit.author.login : null
    const commitAuthorName =
      commit.commit && commit.commit.author && commit.commit.author.name
        ? commit.commit.author.name
        : null

    let pull = null
    try {
      const pulls = await githubFetch(associatedPullsPath(owner, name, sha), token)
      pull = firstAssociatedPull(pulls, sha)
    } catch (error) {
      pull = null
    }

    const groupKey = pull && pull.number ? `pr:${pull.number}` : `commit:${sha}`
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        prNumber: pull && pull.number ? pull.number : null,
        author:
          pull && pull.user && pull.user.login
            ? pull.user.login
            : commitAuthorLogin || commitAuthorName,
        subject: pull && pull.title ? pull.title : commitSubject,
        commitSubject,
        commits: []
      })
    }

    const group = groups.get(groupKey)
    group.commits.push(sha)
    if (pull && pull.number && !group.prNumber) {
      group.prNumber = pull.number
    }
    if (pull && pull.user && pull.user.login) {
      group.author = pull.user.login
    }
    if (pull && pull.title) {
      group.subject = pull.title
    }
    if (!group.subject) {
      group.subject = commitSubject
    }
    group.commitSubject = group.commitSubject || commitSubject
  }

  return { groups, previousTag }
}

function renderReleaseNotes(groups, tagDescription) {
  const categories = {
    features: [],
    improvements: [],
    fixes: [],
    other: []
  }

  for (const group of groups.values()) {
    const rendered = renderGroupLine(group)
    if (rendered && categories[rendered.category]) {
      categories[rendered.category].push(rendered.text)
    }
  }

  const description = typeof tagDescription === 'string' ? tagDescription.trim() : ''
  const lines = []
  if (description) {
    lines.push(description, '')
  }
  lines.push('Thank you to all the contributors that made this release possible!', '', '# Features')

  lines.push(...categories.features)
  lines.push('', '# Improvements')
  lines.push(...categories.improvements)
  lines.push('', '# Fixes')
  lines.push(...categories.fixes)
  lines.push('', '# Other stuff')
  lines.push(...categories.other)
  lines.push('')

  return lines.join('\n')
}

async function generateReleaseNotes(options) {
  let parsedOptions = options
  if (typeof options === 'string') {
    parsedOptions = parseArgs([options])
  } else if (Array.isArray(options)) {
    parsedOptions = parseArgs(options)
  } else if (!options || !options.tag) {
    parsedOptions = parseArgs(process.argv.slice(2))
  }

  const { groups } = await collectReleaseGroups(parsedOptions)
  const token = tokenFromEnvironment()
  const tagDescription = await fetchTagDescription(
    parsedOptions.repository,
    parsedOptions.to,
    token
  )
  return renderReleaseNotes(groups, tagDescription)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const notes = await generateReleaseNotes(options)

  if (options.output && options.output !== '-') {
    const fs = require('fs')
    const path = require('path')
    const directory = path.dirname(path.resolve(options.output))
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(options.output, notes, 'utf8')
  } else {
    process.stdout.write(notes)
  }
}

module.exports = {
  generateReleaseNotes,
  parseArgs,
  renderReleaseNotes
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error)
    process.exitCode = 1
  })
}
