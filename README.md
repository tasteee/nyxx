# nyxx

A tiny CLI that maps short, memorable commands to the long ones you always forget. Define your scripts once in `nyxx.yml` — nyxx handles the rest.

## Install

```sh
npm install -g nyxx
# or
pnpm add -g nyxx
```

## Usage

Run `nyxx` with no arguments to see all available scripts at a glance.

```sh
nyxx
```

Run any command you've defined:

```sh
nyxx dev web
nyxx build ui --watch
nyxx release api beta
```

## Configuration

Create a `nyxx.yml` at the root of your project. Each command has an `input` (what you type) and an `output` (what actually runs). Use `{{double braces}}` for template variables, and `defaults` for optional arguments.

```yaml
commands:
  dev:
    input: 'dev <app>'
    output: 'pnpm --filter @my-org/{{app}} dev'

  build:
    input: 'build <pkg> [...args]'
    output: 'pnpm --filter @my-org/{{pkg}} build {{args}}'

  release:
    input: 'release <pkg> [tag]'
    output: 'pnpm --filter @my-org/{{pkg}} publish --tag {{tag}} --access public'
    defaults:
      tag: latest
```

### Global config

Commands you want available in every project, regardless of the current directory, can live in a global config at `~/.nyxx.yml`. It uses the same format as a project's `nyxx.yml`.

When `nyxx` runs, it merges the global config with the nearest project-local `nyxx.yml` — found by walking up from the current directory, the same way git finds `.git` — so it works from any subfolder, not just the project root. Local commands take precedence over global ones with the same name. Either file may be present on its own; only if neither exists does `nyxx` error out.

Running `nyxx` with no arguments also creates `~/.nyxx.yml` for you if it doesn't exist yet, starting with no commands (`commands: {}`), so there's nothing to set up by hand before adding your first global command.

You can also register a global command straight from the terminal, without editing YAML:

```sh
nyxx --save lint -- eslint . --fix
```

Everything after `--` is saved verbatim as the command's `output`, and `lint` becomes available from any directory as `nyxx lint`. `--save` is reserved, so a command's `input` in your `nyxx.yml` can never start with `--`.

For a multi-word `input` (with arguments like `<foo>`) or an `output` containing template placeholders like `{{foo}}`, quote each one as a single shell argument — otherwise your shell will split on spaces or try to interpret `<foo>` as input redirection:

```sh
nyxx --save "commit <message>" -- "git commit -m {{message}}"
```

This registers `commit <message>` as the command's `input`, so `nyxx commit "fix bug"` runs `git commit -m "fix bug"`.

### Where a command runs

By default, a command runs in whatever directory you invoked `nyxx` from. Add `runIn: project` to a command to have it run from the nearest ancestor directory containing a `package.json` instead — useful for commands that assume they're at a package root (like cleaning `dist` or `node_modules`) regardless of which subfolder you called them from.

```yaml
commands:
  clean:
    input: 'clean'
    output: 'rm -rf dist node_modules'
    runIn: 'project'
```

### Argument syntax

| Syntax      | Meaning                                    |
| ----------- | ------------------------------------------ |
| `<name>`    | Required argument                          |
| `[name]`    | Optional argument                          |
| `[...name]` | Optional, captures all remaining arguments |

Defaults kick in for optional arguments when nothing is passed.
