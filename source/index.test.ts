import path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parse as parseYaml } from 'yaml'

const mockReadFile = vi.hoisted(() => vi.fn())
const mockAccess = vi.hoisted(() => vi.fn())
const mockWriteFile = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', () => {
  return {
    default: {
      readFile: mockReadFile,
      access: mockAccess,
      writeFile: mockWriteFile,
    },
  }
})

const mockExeca = vi.hoisted(() => vi.fn())

vi.mock('execa', () => {
  return {
    execa: mockExeca,
  }
})

const enoentError = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

import {
  getPackageJsonScripts,
  getNyxxConfig,
  getGlobalConfigPath,
  findNearestLocalConfig,
  ensureGlobalConfigExists,
  parseSaveInvocation,
  saveGlobalCommand,
  printScriptList,
  runMappedCommand,
} from './index.ts'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getPackageJsonScripts', () => {
  it('returns parsed scripts from package.json', async () => {
    const fakePackageJson = JSON.stringify({ scripts: { build: 'tsdown', test: 'vitest' } })
    mockReadFile.mockResolvedValue(fakePackageJson)

    const scripts = await getPackageJsonScripts()

    expect(scripts).toEqual({ build: 'tsdown', test: 'vitest' })
  })

  it('returns empty object when no scripts field exists', async () => {
    const fakePackageJson = JSON.stringify({ name: 'test' })
    mockReadFile.mockResolvedValue(fakePackageJson)

    const scripts = await getPackageJsonScripts()

    expect(scripts).toEqual({})
  })

  it('returns empty object when package.json does not exist', async () => {
    mockReadFile.mockRejectedValue(enoentError())

    const scripts = await getPackageJsonScripts()

    expect(scripts).toEqual({})
  })
})

describe('getNyxxConfig', () => {
  it('parses and returns the local nyxx yaml config', async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath === getGlobalConfigPath()) throw enoentError()
      return `commands:\n  build:\n    input: 'build <pkg>'\n    output: 'pnpm build'`
    })

    const config = await getNyxxConfig()

    expect(config.commands.build.input).toBe('build <pkg>')
    expect(config.commands.build.output).toBe('pnpm build')
  })

  it('falls back to the global config when no local nyxx.yml exists', async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath === getGlobalConfigPath()) {
        return `commands:\n  deploy:\n    input: 'deploy <app>'\n    output: 'pnpm deploy {{app}}'`
      }
      throw enoentError()
    })

    const config = await getNyxxConfig()

    expect(config.commands.deploy.input).toBe('deploy <app>')
  })

  it('merges global and local commands, with local commands taking precedence', async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath === getGlobalConfigPath()) {
        return `commands:\n  deploy:\n    input: 'deploy <app>'\n    output: 'global deploy'\n  status:\n    input: 'status'\n    output: 'git status'`
      }
      return `commands:\n  deploy:\n    input: 'deploy <app>'\n    output: 'local deploy'`
    })

    const config = await getNyxxConfig()

    expect(config.commands.deploy.output).toBe('local deploy')
    expect(config.commands.status.output).toBe('git status')
  })

  it('throws a helpful error when neither config exists', async () => {
    mockReadFile.mockRejectedValue(enoentError())

    await expect(getNyxxConfig()).rejects.toThrow(getGlobalConfigPath())
  })

  it('rejects a user-defined command whose input starts with "--"', async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath === getGlobalConfigPath()) throw enoentError()
      return `commands:\n  bad:\n    input: '--save'\n    output: 'echo oops'`
    })

    await expect(getNyxxConfig()).rejects.toThrow(/reserved/)
  })
})

describe('parseSaveInvocation', () => {
  it('parses a well-formed --save invocation', () => {
    const result = parseSaveInvocation(['--save', 'lint', '--', 'eslint', '.', '--fix'])

    expect(result).toEqual({ name: 'lint', commandTokens: ['eslint', '.', '--fix'] })
  })

  it('returns null when the first token is not --save', () => {
    expect(parseSaveInvocation(['lint', '--', 'eslint'])).toBeNull()
  })

  it('returns null when the -- separator is missing', () => {
    expect(parseSaveInvocation(['--save', 'lint', 'eslint'])).toBeNull()
  })

  it('returns null when the name is missing', () => {
    expect(parseSaveInvocation(['--save', '--', 'eslint'])).toBeNull()
  })

  it('returns null when there are no command tokens after --', () => {
    expect(parseSaveInvocation(['--save', 'lint', '--'])).toBeNull()
  })

  it('parses a quoted multi-word name with a placeholder, and a quoted output', () => {
    // Simulates: nyxx --save "commit <message>" -- "git commit -m {{message}}"
    // After shell quoting, each quoted string arrives as a single argv entry.
    const result = parseSaveInvocation(['--save', 'commit <message>', '--', 'git commit -m {{message}}'])

    expect(result).toEqual({
      name: 'commit <message>',
      commandTokens: ['git commit -m {{message}}'],
    })
  })
})

describe('saveGlobalCommand', () => {
  it('writes a new command into an empty global config', async () => {
    mockReadFile.mockRejectedValue(enoentError())
    mockWriteFile.mockResolvedValue(undefined)

    const output = await saveGlobalCommand('lint', ['eslint', '.', '--fix'])

    expect(output).toBe('eslint . --fix')
    const [writtenPath, writtenContent] = mockWriteFile.mock.calls[0]
    expect(writtenPath).toBe(getGlobalConfigPath())
    expect(writtenContent).toContain('lint:')
    expect(writtenContent).toContain('eslint . --fix')
  })

  it('preserves existing global commands when adding a new one', async () => {
    mockReadFile.mockResolvedValue(`commands:\n  deploy:\n    input: 'deploy'\n    output: 'pnpm deploy'`)
    mockWriteFile.mockResolvedValue(undefined)

    await saveGlobalCommand('lint', ['eslint', '.'])

    const [, writtenContent] = mockWriteFile.mock.calls[0]
    expect(writtenContent).toContain('deploy')
    expect(writtenContent).toContain('lint:')
  })

  it('quotes command tokens that contain spaces', async () => {
    mockReadFile.mockRejectedValue(enoentError())
    mockWriteFile.mockResolvedValue(undefined)

    const output = await saveGlobalCommand('greet', ['echo', 'hello world'])

    expect(output).toBe('echo "hello world"')
  })

  it('uses a single quoted output token as-is, without re-quoting it', async () => {
    mockReadFile.mockRejectedValue(enoentError())
    mockWriteFile.mockResolvedValue(undefined)

    const output = await saveGlobalCommand('commit', ['git commit -m {{message}}'])

    expect(output).toBe('git commit -m {{message}}')
    const [, writtenContent] = mockWriteFile.mock.calls[0]
    expect(writtenContent).toContain('git commit -m {{message}}')
  })

  it('stores a multi-word quoted name as the command input', async () => {
    mockReadFile.mockRejectedValue(enoentError())
    mockWriteFile.mockResolvedValue(undefined)

    await saveGlobalCommand('commit <message>', ['git commit -m {{message}}'])

    const [, writtenContent] = mockWriteFile.mock.calls[0]
    const written = parseYaml(writtenContent)
    expect(written.commands['commit <message>'].input).toBe('commit <message>')
  })
})

describe('ensureGlobalConfigExists', () => {
  beforeEach(() => {
    mockAccess.mockReset()
    mockWriteFile.mockReset()
  })

  it('does nothing when the global config already exists', async () => {
    mockAccess.mockResolvedValue(undefined)

    await ensureGlobalConfigExists()

    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('creates an empty global config when none exists', async () => {
    mockAccess.mockRejectedValue(enoentError())
    mockWriteFile.mockResolvedValue(undefined)

    await ensureGlobalConfigExists()

    expect(mockWriteFile).toHaveBeenCalledWith(getGlobalConfigPath(), expect.stringContaining('commands: {}'), 'utf8')
  })

  it('rethrows unexpected errors from the existence check', async () => {
    mockAccess.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }))

    await expect(ensureGlobalConfigExists()).rejects.toThrow('EACCES')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})

describe('findNearestLocalConfig', () => {
  it('finds nyxx.yml by walking up from a nested directory', async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath === '/repo/nyxx.yml') return `commands:\n  build:\n    input: 'build'\n    output: 'pnpm build'`
      throw enoentError()
    })

    const result = await findNearestLocalConfig('/repo/packages/ui/src')

    expect(result?.directory).toBe('/repo')
    expect(result?.config.commands.build.output).toBe('pnpm build')
  })

  it('returns null when no nyxx.yml exists in any ancestor directory', async () => {
    mockReadFile.mockRejectedValue(enoentError())

    const result = await findNearestLocalConfig('/repo/packages/ui/src')

    expect(result).toBeNull()
  })
})

describe('runMappedCommand', () => {
  beforeEach(() => {
    mockExeca.mockResolvedValue(undefined)
  })

  it('compiles template and calls execa with the correct arguments', async () => {
    const commandConfig = {
      input: 'build <pkg>',
      output: 'pnpm --filter {{pkg}} build',
    }
    const values = { pkg: 'my-app' }

    await runMappedCommand(commandConfig, values, '/repo/packages/ui/src')

    expect(mockExeca).toHaveBeenCalledWith('pnpm', ['--filter', 'my-app', 'build'], {
      stdio: 'inherit',
      cwd: '/repo/packages/ui/src',
    })
  })

  it('applies defaults when values are not provided', async () => {
    const commandConfig = {
      input: 'release <pkg> [tag]',
      output: 'pnpm publish --tag {{tag}}',
      defaults: { tag: 'latest' },
    }
    const values = {}

    await runMappedCommand(commandConfig, values, '/repo')

    expect(mockExeca).toHaveBeenCalledWith('pnpm', ['publish', '--tag', 'latest'], { stdio: 'inherit', cwd: '/repo' })
  })

  it('provided values override defaults', async () => {
    const commandConfig = {
      input: 'release <pkg> [tag]',
      output: 'pnpm publish --tag {{tag}}',
      defaults: { tag: 'latest' },
    }
    const values = { tag: 'beta' }

    await runMappedCommand(commandConfig, values, '/repo')

    expect(mockExeca).toHaveBeenCalledWith('pnpm', ['publish', '--tag', 'beta'], { stdio: 'inherit', cwd: '/repo' })
  })

  it('defaults to running in the invocation directory when runIn is unset', async () => {
    const commandConfig = { input: 'status', output: 'git status' }

    await runMappedCommand(commandConfig, {}, '/repo/packages/ui/src')

    expect(mockExeca).toHaveBeenCalledWith('git', ['status'], { stdio: 'inherit', cwd: '/repo/packages/ui/src' })
  })

  it("runs in the nearest package.json directory when runIn is 'project'", async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath === '/repo/package.json') return JSON.stringify({ name: 'repo' })
      throw enoentError()
    })

    const commandConfig = { input: 'clean', output: 'rm -rf dist', runIn: 'project' as const }

    await runMappedCommand(commandConfig, {}, '/repo/packages/ui/src')

    expect(mockExeca).toHaveBeenCalledWith('rm', ['-rf', 'dist'], { stdio: 'inherit', cwd: '/repo' })
  })

  it("falls back to the invocation directory when runIn is 'project' but no package.json is found", async () => {
    mockReadFile.mockRejectedValue(enoentError())

    const commandConfig = { input: 'clean', output: 'rm -rf dist', runIn: 'project' as const }

    await runMappedCommand(commandConfig, {}, '/repo/packages/ui/src')

    expect(mockExeca).toHaveBeenCalledWith('rm', ['-rf', 'dist'], { stdio: 'inherit', cwd: '/repo/packages/ui/src' })
  })

  it('runs a command saved via a quoted --save invocation with a placeholder', async () => {
    // End-to-end: nyxx --save "commit <message>" -- "git commit -m {{message}}"
    mockReadFile.mockRejectedValue(enoentError())
    mockWriteFile.mockResolvedValue(undefined)

    const parsed = parseSaveInvocation(['--save', 'commit <message>', '--', 'git commit -m {{message}}'])!
    const output = await saveGlobalCommand(parsed.name, parsed.commandTokens)
    const commandConfig = { input: parsed.name, output }

    await runMappedCommand(commandConfig, { message: 'wip' }, '/repo')

    expect(mockExeca).toHaveBeenCalledWith('git', ['commit', '-m', 'wip'], { stdio: 'inherit', cwd: '/repo' })
  })
})

describe('printScriptList', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
  })

  it('prints the package scripts section header', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ scripts: { build: 'tsdown' } }))
    const config = { commands: { release: { input: 'release <pkg>', output: 'pnpm publish' } } }

    await printScriptList(config)

    const loggedLines = consoleLogSpy.mock.calls.map((callArguments) => callArguments[0] ?? '').join('\n')
    expect(loggedLines).toContain('package scripts')
  })

  it('prints the nyxx scripts section header', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ scripts: { build: 'tsdown' } }))
    const config = { commands: { release: { input: 'release <pkg>', output: 'pnpm publish' } } }

    await printScriptList(config)

    const loggedLines = consoleLogSpy.mock.calls.map((callArguments) => callArguments[0] ?? '').join('\n')
    expect(loggedLines).toContain('nyxx scripts')
  })

  it('prints each package script name and value', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ scripts: { build: 'tsdown', test: 'vitest' } }))
    const config = { commands: { release: { input: 'release <pkg>', output: 'pnpm publish' } } }

    await printScriptList(config)

    const loggedLines = consoleLogSpy.mock.calls.map((callArguments) => callArguments[0] ?? '').join('\n')
    expect(loggedLines).toContain('build')
    expect(loggedLines).toContain('tsdown')
    expect(loggedLines).toContain('test')
    expect(loggedLines).toContain('vitest')
  })

  it('prints each nyxx command input and output', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ scripts: { build: 'tsdown' } }))
    const config = {
      commands: {
        release: { input: 'release <pkg>', output: 'pnpm publish' },
        workspace: { input: 'publish <pkg> [...args]', output: 'pnpm --filter {{pkg}} {{args}}' },
      },
    }

    await printScriptList(config)

    const loggedLines = consoleLogSpy.mock.calls.map((callArguments) => callArguments[0] ?? '').join('\n')
    expect(loggedLines).toContain('release <pkg>')
    expect(loggedLines).toContain('pnpm publish')
    expect(loggedLines).toContain('publish <pkg> [...args]')
    expect(loggedLines).toContain('pnpm --filter {{pkg}} {{args}}')
  })

  it('aligns columns so shorter names have more padding', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ scripts: { a: 'VALUE_SHORT', verylongscriptname: 'VALUE_LONG' } }))
    const config = { commands: { build: { input: 'build <pkg>', output: 'pnpm build' } } }

    await printScriptList(config)

    const ansiRegex = /\x1b\[[0-9;]*m/g
    const stripAnsi = (text: string) => text.replace(ansiRegex, '')

    const strippedLines = consoleLogSpy.mock.calls.map((callArguments) => stripAnsi(callArguments[0] ?? ''))
    const shortKeyLine = strippedLines.find((line) => line.includes('VALUE_SHORT')) ?? ''
    const longKeyLine = strippedLines.find((line) => line.includes('VALUE_LONG')) ?? ''

    const shortValueColumnStart = shortKeyLine.indexOf('VALUE_SHORT')
    const longValueColumnStart = longKeyLine.indexOf('VALUE_LONG')

    expect(shortValueColumnStart).toBe(longValueColumnStart)
  })
})
