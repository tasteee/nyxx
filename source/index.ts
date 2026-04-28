#!/usr/bin/env node

import fs from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { cac } from 'cac'
import { execa } from 'execa'
import { parse as parseYaml } from 'yaml'
import { parseArgsStringToArgv } from 'string-argv'
import Handlebars from 'handlebars'

export type CommandConfigT = {
  input: string
  output: string
  defaults?: Record<string, string>
}

// script may have been ran from nested folder,
// so we need to change the current working directory
// to the root of the project to be able to find the config file
process.chdir(process.cwd())

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

export const getNyxxConfig = async () => {
  const configText = await fs.readFile('nyxx.yml', 'utf8')
  const config = parseYaml(configText)
  return config
}

export const getPackageJsonScripts = async (): Promise<Record<string, string>> => {
  const packageJsonText = await fs.readFile('package.json', 'utf8')
  const packageJson = JSON.parse(packageJsonText)
  const scripts = packageJson.scripts as Record<string, string> | undefined
  return scripts ?? {}
}

export const printScriptList = async (config: Awaited<ReturnType<typeof getNyxxConfig>>) => {
  const packageScripts = await getPackageJsonScripts()
  const packageScriptEntries = Object.entries(packageScripts)
  const nyxxCommandEntries = Object.entries(config.commands as Record<string, CommandConfigT>)

  const packageNameColumnWidth = Math.max(...packageScriptEntries.map((entry) => entry[0].length))
  const nyxxInputColumnWidth = Math.max(...nyxxCommandEntries.map((entry) => entry[1].input.length))
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

export const runMappedCommand = async (commandConfig: CommandConfigT, values: Record<string, string>) => {
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

  await execa(commandName, executableArguments, {
    stdio: 'inherit',
  })
}

const main = async () => {
  const config = await getNyxxConfig()

  const hasNoArguments = process.argv.slice(2).length === 0
  if (hasNoArguments) {
    await printScriptList(config)
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

      await runMappedCommand(commandConfig, options)
    })
  }

  commandLineInterface.help()
  commandLineInterface.parse()
}

const currentFilePath = fileURLToPath(import.meta.url)
const isDirectlyExecuted = process.argv[1] === currentFilePath
if (isDirectlyExecuted) await main()
