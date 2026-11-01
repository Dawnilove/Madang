// Exit 0 means JSON was printed; read its outcome. Exit 64 is invalid input, 1 is failure without exit proof.
import {
  MADANGD_CANCEL_MANAGED_STOP_FLAG,
  MADANGD_COMPLETE_MANAGED_STOP_FLAG,
  MADANGD_MANAGED_STOP_REQUEST_FILE_FLAG,
  MadangdManagedStopRequestSchema,
  type MadangdManagedStopCancellation,
  type MadangdManagedStopCompletion,
  type MadangdManagedStopRequest
} from '../../shared/madangd-stop-request'
import { cancelMadangdManagedStop } from './madangd-managed-stop-cancellation'
import { readMadangdCompletedStopReceipt } from './madangd-completed-stop-receipt'
import { readMadangdManagedStopRequest } from './madangd-managed-stop-request'
import { ZodError } from 'zod'
import {
  completeMadangdManagedStop,
  type MadangdManagedStopCompletionOptions
} from './madangd-managed-stop-completion'

export async function runMadangdManagedStopCommand(
  argv: readonly string[],
  options: MadangdManagedStopCompletionOptions = {}
): Promise<MadangdManagedStopCompletion> {
  const request = parseRequestArgument(argv, MADANGD_COMPLETE_MANAGED_STOP_FLAG)
  const verdict = await completeMadangdManagedStop(request, options)
  const retirement =
    verdict === 'exited' && request.retireIdleDaemon
      ? readMadangdCompletedStopReceipt(request)?.retirement
      : undefined
  const completion: MadangdManagedStopCompletion = {
    ...request,
    kind: 'madangd_managed_stop_completion',
    verdict,
    receiptPersisted: verdict === 'exited',
    ...(retirement ? { retirement } : {})
  }
  process.stdout.write(`${JSON.stringify(completion)}\n`)
  return completion
}

export function runMadangdManagedStopCancelCommand(
  argv: readonly string[]
): MadangdManagedStopCancellation {
  const request = parseRequestArgument(argv, MADANGD_CANCEL_MANAGED_STOP_FLAG)
  const cancellation: MadangdManagedStopCancellation = {
    ...request,
    kind: 'madangd_managed_stop_cancellation',
    outcome: cancelMadangdManagedStop(request)
  }
  process.stdout.write(`${JSON.stringify(cancellation)}\n`)
  return cancellation
}

function parseRequestArgument(argv: readonly string[], flag: string): MadangdManagedStopRequest {
  if (argv[0] !== flag) {
    throw new Error('madangd_managed_stop_invalid_arguments')
  }
  if (argv[1] === MADANGD_MANAGED_STOP_REQUEST_FILE_FLAG) {
    if (argv.length !== 3 || !argv[2]) {
      throw new Error('madangd_managed_stop_invalid_arguments')
    }
    return readMadangdManagedStopRequest(argv[2])
  }
  if (argv.length !== 2 || !argv[1]) {
    throw new Error('madangd_managed_stop_invalid_arguments')
  }
  return MadangdManagedStopRequestSchema.parse(JSON.parse(argv[1]))
}

export const MADANGD_MANAGED_STOP_EXIT_VERDICT = 0
export const MADANGD_MANAGED_STOP_EXIT_FAILED = 1
export const MADANGD_MANAGED_STOP_EXIT_USAGE = 64

export async function runMadangdManagedStopCommandAndExit(argv: readonly string[]): Promise<void> {
  let code = MADANGD_MANAGED_STOP_EXIT_VERDICT
  try {
    if (argv[0] === MADANGD_CANCEL_MANAGED_STOP_FLAG) {
      runMadangdManagedStopCancelCommand(argv)
    } else {
      await runMadangdManagedStopCommand(argv)
    }
  } catch (error) {
    console.error('madangd: managed stop failed:', error)
    code =
      error instanceof ZodError ||
      error instanceof SyntaxError ||
      (error instanceof Error && error.message === 'madangd_managed_stop_invalid_arguments')
        ? MADANGD_MANAGED_STOP_EXIT_USAGE
        : MADANGD_MANAGED_STOP_EXIT_FAILED
  }
  // Drain stdout before exit: callers read the result to EOF.
  process.stdout.write('', () => process.exit(code))
}
