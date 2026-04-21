export type CommandResult = {
  readonly ok: boolean
  readonly command: string
  readonly data?: unknown
  readonly message?: string
}

export function printResult(result: CommandResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (result.message) console.log(result.message)
  if (result.data !== undefined) {
    console.log(JSON.stringify(result.data, null, 2))
  }
}

export function printError(command: string, error: unknown, json: boolean): void {
  const message = error instanceof Error ? error.message : String(error)
  const result: CommandResult = { ok: false, command, message }
  if (json) {
    console.error(JSON.stringify(result, null, 2))
  } else {
    console.error(message)
  }
}
