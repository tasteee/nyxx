import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockReadFile = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', () => {
  return {
    default: {
      readFile: mockReadFile,
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
  printScriptList,
  runMappedCommand,
} from './index.ts'

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

    await runMappedCommand(commandConfig, values)

    expect(mockExeca).toHaveBeenCalledWith('pnpm', ['--filter', 'my-app', 'build'], { stdio: 'inherit' })
  })

  it('applies defaults when values are not provided', async () => {
    const commandConfig = {
      input: 'release <pkg> [tag]',
      output: 'pnpm publish --tag {{tag}}',
      defaults: { tag: 'latest' },
    }
    const values = {}

    await runMappedCommand(commandConfig, values)

    expect(mockExeca).toHaveBeenCalledWith('pnpm', ['publish', '--tag', 'latest'], { stdio: 'inherit' })
  })

  it('provided values override defaults', async () => {
    const commandConfig = {
      input: 'release <pkg> [tag]',
      output: 'pnpm publish --tag {{tag}}',
      defaults: { tag: 'latest' },
    }
    const values = { tag: 'beta' }

    await runMappedCommand(commandConfig, values)

    expect(mockExeca).toHaveBeenCalledWith('pnpm', ['publish', '--tag', 'beta'], { stdio: 'inherit' })
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
