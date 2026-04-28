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

### Argument syntax

| Syntax      | Meaning                                    |
| ----------- | ------------------------------------------ |
| `<name>`    | Required argument                          |
| `[name]`    | Optional argument                          |
| `[...name]` | Optional, captures all remaining arguments |

Defaults kick in for optional arguments when nothing is passed.
