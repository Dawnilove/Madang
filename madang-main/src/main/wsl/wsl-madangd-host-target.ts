/** kind distinguishes WSL from SSH targets; id/distro match the deployment record and label names the environment. */
export type WslMadangdHostTarget = {
  kind: 'wsl'
  id: string
  distro: string
  label: string
}
