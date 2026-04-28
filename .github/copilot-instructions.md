## Purpose

This document defines strict coding rules for this repository.
Follow these rules exactly when generating or editing code.

Code should optimize for readability and low cognitive load.
Prefer explicit, predictable code over short or clever code.

---

## Priority Order (When Rules Conflict)

Apply rules in this exact order:

1. Non-Negotiables
2. TypeScript Rules
3. Control Flow Rules
4. Naming Rules
5. React Rules
6. CSS Rules
7. Examples

If an example conflicts with a rule, follow the rule.

---

## Non-Negotiables

- No `function` keyword. Use arrow functions only.
- No implicit arrow returns. Always use braces and explicit `return`.
- No `interface`. Use `type` only.
- No `enum`. Use `const` objects with `as const`.
- No destructuring (objects, arrays, params).
- No `else` or `else if`. Use early returns.
- No inline logic inside `if` conditions. Extract to named variables first.
- No abbreviations in variable names.
- No `try/catch` for promise flow. Use `await-to-js`.
- No classes or OOP.
- No Tailwind utility classes.
- No hardcoded style values. Use design-system CSS variables.

---

## Core Principle

Every meaningful computation must have a descriptive variable name.
Identifiers are self-documenting. Code should read top-to-bottom like
short, clear sentences.

---

## 1) Control Flow

Use flat code and early returns. Always void nesting when possible.

Rules:

- One-line `if` body: omit braces.
- Multi-line `if` body: use braces.
- Never write `else` or `else if`.
- Never place complex logic directly in conditionals.

Example:

```ts
const getLabel = (count: number): string => {
  const isEmpty = count === 0
  if (isEmpty) return 'No items'

  const isSingle = count === 1
  if (isSingle) return 'One item'

  return `${count} items`
}
```

---

## 2) Functions

Use arrow functions only.
Always use block bodies and explicit returns.

Example:

```ts
const add = (firstNumber: number, secondNumber: number): number => {
  return firstNumber + secondNumber
}
```

---

## 3) Variables Over Inline Logic

Do not embed meaningful logic in JSX, return statements, or conditions.
Compute values first. Name them clearly.

Example:

```ts
const hasItems = cart.length > 0
const isCheckoutEnabled = hasItems && isUserLoggedIn
const buttonLabel = isCheckoutEnabled ? 'Checkout' : 'Add items to cart'
```

---

## 4) No Destructuring

Do not destructure:

- function parameters
- local variables
- arrays
- object properties

Always access values from their source reference.

Example:

```ts
const UserCard = (props: UserCardPropsT) => {
  return <div>{props.user.name}</div>
}
```

---

## 5) TypeScript Rules

- Use `type`, never `interface`.
- Type names must end with `T`.
- Use `const` objects with `as const` instead of enums.

Example:

```ts
type UserT = {
  id: string
  name: string
  role: 'admin' | 'member'
}

const Direction = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
} as const

type DirectionT = (typeof Direction)[keyof typeof Direction]
```

---

## 6) Async Rules

Use `await-to-js` for async error handling.
Handle each error immediately with an early return.

Example:

```ts
import { to } from 'await-to-js'

const loadUser = async (userId: string): Promise<UserT | null> => {
  const [fetchUserError, fetchedUser] = await to(fetchUser(userId))
  if (fetchUserError) return handleError(fetchUserError)
  const [saveUserError] = await to(saveToCache(fetchedUser))
  if (saveUserError) return handleError(saveUserError)
  return fetchedUser
}
```

---

## 7) Naming Rules

Use full descriptive names.
Do not abbreviate.

Examples:

- `user`, not `usr`
- `button`, not `btn`
- `error`, not `err`
- `response`, not `res`
- `configuration`, not `cfg`
- `request`, not `req`
- `handlerFunction`, not `fn`
- `index`, not `i`

---

## 8) React Rules

- Function components only.
- No class components.
- No prop destructuring.
- Named exports only.
- Keep component responsibility narrow.
- Root `className` must match component name in camelCase.

Example:

```tsx
type ProfileCardPropsT = {
  user: {
    firstName: string
    lastName: string
    verifiedAt: string | null
  }
}

const ProfileCard = (props: ProfileCardPropsT) => {
  const fullName = `${props.user.firstName} ${props.user.lastName}`
  const isVerified = props.user.verifiedAt !== null

  return (
    <div className="profileCard">
      <span className="profileCardName">{fullName}</span>
      {isVerified && <span className="profileCardBadge">Verified</span>}
    </div>
  )
}
```

Before finalizing generated code, verify:

- Uses arrow functions with explicit returns.
- Uses `type` and `T` suffixes.
- Uses no destructuring.
- Uses no `else` / `else if`.
- Uses named variables for meaningful logic.
- Uses descriptive non-abbreviated names.
- Uses `await-to-js` for async error handling.
- Uses no classes and no Tailwind utilities.
- Used no abbreviated parameters like `i`, `err`, `res`, `cfg`, `e`, `evt`, etc.
