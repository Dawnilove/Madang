import type { OrcaRuntimeService } from '../madang-runtime'

export type WorkerTerminalReleaseRuntime = Pick<
  OrcaRuntimeService,
  | 'retireStructuredAgentSessionTabFromSnapshot'
  | 'forgetStructuredSessionMail'
  | 'resolveOrchestrationWorkerServer'
  | 'callOrchestrationWorkerServer'
  | 'getOrchestrationFleetAgentStatusSnapshot'
  | 'getOrchestrationDb'
  | 'showTerminal'
  | 'resolveTerminalHandleByProcessIncarnation'
  | 'getTerminalPaneKey'
  | 'getTerminalProcessIncarnation'
  | 'getTerminalLivenessVerdict'
  | 'checkTerminalAgentPresence'
  | 'getOrchestrationDispatchAuthority'
  | 'ensureStructuredAgentSessionHost'
  | 'inspectTerminalProcessIncarnationLiveness'
  | 'closeTerminal'
  | 'getExactWorkerProviderSession'
  | 'readTerminal'
  | 'notifyMessageArrived'
>
