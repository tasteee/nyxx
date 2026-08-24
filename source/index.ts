#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { cac } from 'cac'
import { execa } from 'execa'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { parseArgsStringToArgv } from 'string-argv'
import Handlebars from 'handlebars'

export type CommandConfigT = {
  input: string
  output: string
  defaults?: Record<string, string>
  // Which directory the command runs in: 'cwd' (default) runs wherever nyxx was
  // invoked from; 'project' runs from the nearest ancestor directory containing
  // a package.json, regardless of how deep the invocation directory is nested.
  runIn?: 'cwd' | 'project'
}

const bold = (text: string): string => {
  return `\x1b[1m${text}\x1b[0m`
}

const dim = (text: string): string => {
  return `\x1b[2m${text}\x1b[0m`
}

const cyan = (text: string): string => {
  return `\x1b[36m${text}\x1b[0m`
}

const yellow = (text: string): string => {
  return `\x1b[33m${text}\x1b[0m`
}

export const getGlobalConfigPath = (): string => {
  return path.join(os.homedir(), '.nyxx.yml')
}

const readYamlFileIfExists = async (filePath: string): Promise<any> => {
  try {
    const text = await fs.readFile(filePath, 'utf8')
    return parseYaml(text)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

// Walks upward from startDirectory (like git finds .git) looking for fileName,
// parsing it with `parse` the first time it's found.
const findNearestFile = async <T>(
  fileName: string,
  startDirectory: string,
  parse: (text: string) => T
): Promise<{ value: T; directory: string } | null> => {
  let currentDirectory = path.resolve(startDirectory)

  while (true) {
    const candidatePath = path.join(currentDirectory, fileName)

    try {
      const text = await fs.readFile(candidatePath, 'utf8')
      return { value: parse(text), directory: currentDirectory }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    const parentDirectory = path.dirname(currentDirectory)
    if (parentDirectory === currentDirectory) return null
    currentDirectory = parentDirectory
  }
}

// Finds the nearest nyxx.yml walking up from startDirectory, so nyxx works from
// any subfolder of a project, not just its root.
export const findNearestLocalConfig = async (startDirectory: string): Promise<{ config: any; directory: string } | null> => {
  const result = await findNearestFile('nyxx.yml', startDirectory, parseYaml)
  return result ? { config: result.value, directory: result.directory } : null
}

// Finds the nearest package.json walking up from startDirectory. This defines
// "the project" for commands with runIn: 'project'.
export const findNearestPackageJsonDir = async (
  startDirectory: string
): Promise<{ packageJson: any; directory: string } | null> => {
  const result = await findNearestFile('package.json', startDirectory, JSON.parse)
  return result ? { packageJson: result.value, directory: result.directory } : null
}

// Merges the global config (~/.nyxx.yml, available from any directory) with the
// nearest project-local nyxx.yml found by walking up from startDirectory, if one
// exists. Local commands take precedence over global commands of the same name.
export const getNyxxConfig = async (startDirectory: string = process.cwd()) => {
  const globalConfig = await readYamlFileIfExists(getGlobalConfigPath())
  const localResult = await findNearestLocalConfig(startDirectory)

  if (!globalConfig && !localResult) {
    throw new Error(`No nyxx.yml found in the current directory or any parent directory, or at ${getGlobalConfigPath()}`)
  }

  const commands = {
    ...(globalConfig?.commands ?? {}),
    ...(localResult?.config?.commands ?? {}),
  }

  for (const [name, commandConfig] of Object.entries(commands as Record<string, CommandConfigT>)) {
    if (commandConfig.input.startsWith('--')) {
      throw new Error(`Invalid command "${name}": input must not start with "--" (reserved for nyxx's own flags, like --save)`)
    }
  }

  return { commands }
}

const emptyGlobalConfigYaml = `# Global nyxx commands, available from any directory.\n# See https://github.com/tasteee/nyxx for the format.\ncommands: {}\n`

// Creates ~/.nyxx.yml with no commands if it doesn't already exist yet.
export const ensureGlobalConfigExists = async (): Promise<void> => {
  const globalConfigPath = getGlobalConfigPath()

  try {
    await fs.access(globalConfigPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await fs.writeFile(globalConfigPath, emptyGlobalConfigYaml, 'utf8')
  }
}

// Parses `--save <name> -- <command...>` from raw argv (process.argv.slice(2)).
// Returns null if argv doesn't match that shape, so the caller can print usage.
export const parseSaveInvocation = (argv: string[]): { name: string; commandTokens: string[] } | null => {
  if (argv[0] !== '--save') return null
  if (argv[2] !== '--') return null

  const name = argv[1]
  const commandTokens = argv.slice(3)
  if (!name || commandTokens.length === 0) return null

  return { name, commandTokens }
}

const quoteArgumentIfNeeded = (argument: string): string => {
  const needsQuoting = /\s|"/.test(argument)
  if (!needsQuoting) return argument
  return `"${argument.replace(/"/g, '\\"')}"`
}

// Registers <name> as a global command that runs commandTokens verbatim,
// writing the result into ~/.nyxx.yml. Returns the joined output string.
//
// A single commandToken (e.g. `-- "git commit -m {{message}}"`) is already the
// full output command as one shell-quoted argument, so it's used as-is; quoting
// it again would make parseArgsStringToArgv treat the whole thing as one argv
// entry at run time instead of splitting it back into words. Multiple tokens
// (e.g. `-- git commit -m "{{message}}"`) are reconstructed with quoting only
// on the tokens that need it, to preserve embedded spaces as single words.
export const saveGlobalCommand = async (name: string, commandTokens: string[]): Promise<string> => {
  const globalConfigPath = getGlobalConfigPath()
  const existingConfig = (await readYamlFileIfExists(globalConfigPath)) ?? {}
  const commands = { ...(existingConfig.commands ?? {}) }

  const output = commandTokens.length === 1 ? commandTokens[0] : commandTokens.map(quoteArgumentIfNeeded).join(' ')

  commands[name] = { input: name, output }
  const updatedConfig = { ...existingConfig, commands }
  await fs.writeFile(globalConfigPath, stringifyYaml(updatedConfig), 'utf8')

  return output
}

export const getPackageJsonScripts = async (startDirectory: string = process.cwd()): Promise<Record<string, string>> => {
  const result = await findNearestPackageJsonDir(startDirectory)
  const scripts = result?.packageJson?.scripts as Record<string, string> | undefined
  return scripts ?? {}
}

export const printScriptList = async (
  config: Awaited<ReturnType<typeof getNyxxConfig>>,
  startDirectory: string = process.cwd()
) => {
  const packageScripts = await getPackageJsonScripts(startDirectory)
  const packageScriptEntries = Object.entries(packageScripts)
  const nyxxCommandEntries = Object.entries(config.commands as Record<string, CommandConfigT>)

  const packageNameColumnWidth = Math.max(0, ...packageScriptEntries.map((entry) => entry[0].length))
  const nyxxInputColumnWidth = Math.max(0, ...nyxxCommandEntries.map((entry) => entry[1].input.length))
  const divider = dim('─'.repeat(42))

  console.log()
  console.log(`  ${bold('package scripts')}`)
  console.log(`  ${divider}`)
  console.log()

  for (const entry of packageScriptEntries) {
    const scriptName = entry[0]
    const scriptValue = entry[1]
    const padding = ' '.repeat(packageNameColumnWidth - scriptName.length + 4)
    console.log(`    ${cyan(scriptName)}${padding}${dim(scriptValue)}`)
  }

  console.log()
  console.log(`  ${bold('nyxx scripts')}`)
  console.log(`  ${divider}`)
  console.log()

  for (const entry of nyxxCommandEntries) {
    const commandConfig = entry[1]
    const padding = ' '.repeat(nyxxInputColumnWidth - commandConfig.input.length + 4)
    console.log(`    ${yellow(commandConfig.input)}${padding}${dim(commandConfig.output)}`)
  }

  console.log()
}

const resolveCommandCwd = async (commandConfig: CommandConfigT, invocationDirectory: string): Promise<string> => {
  if (commandConfig.runIn !== 'project') return invocationDirectory
  const result = await findNearestPackageJsonDir(invocationDirectory)
  return result?.directory ?? invocationDirectory
}

export const runMappedCommand = async (
  commandConfig: CommandConfigT,
  values: Record<string, string>,
  invocationDirectory: string = process.cwd()
) => {
  const defaults = commandConfig.defaults || {}

  const templateData = {
    ...defaults,
    ...values,
  }

  const template = Handlebars.compile(commandConfig.output)
  const commandText = template(templateData)
  const commandArguments = parseArgsStringToArgv(commandText)
  const commandName = commandArguments[0]
  const executableArguments = commandArguments.slice(1)
  const cwd = await resolveCommandCwd(commandConfig, invocationDirectory)

  await execa(commandName, executableArguments, {
    stdio: 'inherit',
    cwd,
  })
}

const main = async () => {
  const invocationDirectory = process.cwd()
  const argv = process.argv.slice(2)

  if (argv[0] === '--save') {
    const parsed = parseSaveInvocation(argv)

    if (!parsed) {
      console.error('Usage: nyxx --save <name> -- <command...>')
      console.error('For a multi-word name or an output with {{placeholders}}, quote each side, e.g.:')
      console.error('  nyxx --save "commit <message>" -- "git commit -m {{message}}"')
      process.exit(1)
    }

    const output = await saveGlobalCommand(parsed.name, parsed.commandTokens)
    console.log(`Saved global command "${parsed.name}" -> ${output}`)
    process.exit(0)
  }

  const hasNoArguments = argv.length === 0

  if (hasNoArguments) {
    await ensureGlobalConfigExists()
  }

  const config = await getNyxxConfig(invocationDirectory)

  if (hasNoArguments) {
    await printScriptList(config, invocationDirectory)
    process.exit(0)
  }

  const commandLineInterface = cac('nyxx')
  const commandEntries = Object.entries(config.commands)

  for (const commandEntry of commandEntries) {
    const commandConfig = commandEntry[1] as CommandConfigT

    commandLineInterface.command(commandConfig.input).action(async (...rawValues) => {
      const options = rawValues[rawValues.length - 1]
      const positionalValues = rawValues.slice(0, -1)
      const inputParts = commandConfig.input.split(' ')

      const checkIfRequired = (inputPart: string) => inputPart.startsWith('<') && inputPart.endsWith('>')
      const checkIsOptional = (inputPart: string) => inputPart.startsWith('[') && inputPart.endsWith(']')

      inputParts.forEach((inputPart, index) => {
        const isRequiredValue = checkIfRequired(inputPart)
        const isOptionalValue = checkIsOptional(inputPart)
        const isValue = isRequiredValue || isOptionalValue
        if (!isValue) return

        const argumentName = inputPart
          .replace('<', '')
          .replace('>', '')
          .replace('[', '')
          .replace(']', '')
          .replace('...', '')

        options[argumentName] = positionalValues[index - 1]
      })

      await runMappedCommand(commandConfig, options, invocationDirectory)
    })
  }

  commandLineInterface.help()
  commandLineInterface.parse()
}

const currentFilePath = fileURLToPath(import.meta.url)
const isDirectlyExecuted = process.argv[1] === currentFilePath
if (isDirectlyExecuted) await main()
