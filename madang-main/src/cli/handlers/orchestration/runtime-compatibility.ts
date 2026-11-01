import { RuntimeClientError } from '../../runtime-client'

export function resolveCompatibilityCliCommand(): 'madang' | 'madang-ide' | 'madang-dev' {
  const configured = process.env.MADANG_CLI_COMMAND
  if (configured === 'madang' || configured === 'madang-ide' || configured === 'madang-dev') {
    return configured
  }
  return process.platform === 'linux' ? 'madang-ide' : 'madang'
}

export function resolvePackagedWindowsCompatibilityCommand(): 'madang' | 'madang-ide' | undefined {
  if (process.env.MADANG_WINDOWS_PACKAGED_CLI_LAUNCHER !== '1') {
    return undefined
  }
  const command = process.env.MADANG_CLI_COMMAND
  if (command === 'madang' || command === 'madang-ide') {
    return command
  }
  throw new RuntimeClientError(
    'invalid_argument',
    'The packaged Madang launcher did not provide a valid resume command. No question was created.'
  )
}

export async function flushOrchestrationStdout(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write('', (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

export function isDevCliInvocation(): boolean {
  return (
    process.env.MADANG_DEV_CLI_INVOCATION === '1' ||
    (process.env.MADANG_USER_DATA_PATH?.includes('madang-dev') ?? false)
  )
}
