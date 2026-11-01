import type { OrcaRuntimeService } from '../madang-runtime'

export type FederationRuntime = Pick<
  OrcaRuntimeService,
  | 'syncOrchestrationFederatedDispatch'
  | 'getOrchestrationDb'
  | 'resolveOrchestrationWorkerServer'
  | 'callOrchestrationWorkerServer'
  | 'notifyMessageArrived'
  | 'reconcileLegacyWorkerTerminals'
>
