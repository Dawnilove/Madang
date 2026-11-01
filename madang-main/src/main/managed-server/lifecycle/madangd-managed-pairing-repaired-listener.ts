let listener: (environmentId: string) => void | Promise<void> = () => {}

export function setManagedMadangdPairingRepairedListener(
  next: (environmentId: string) => void | Promise<void>
): void {
  listener = next
}

export function notifyManagedMadangdPairingRepaired(environmentId: string): void | Promise<void> {
  return listener(environmentId)
}
