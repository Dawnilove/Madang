import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const SERVE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['serve'],
    summary: 'Start a Madang runtime server without opening a desktop window',
    usage:
      'madang serve [--port <port>] [--pairing-address <host>] [--mobile-pairing] [--no-pairing] [--grant-desktop-control] [--project-root <path>] [--recipe-json] [--supervise] [--force] [--reclaim-stale-lock [--data-root <dir>] [--yes]] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'port',
      'pairing-address',
      'mobile-pairing',
      'no-pairing',
      'grant-desktop-control',
      'project-root',
      'recipe-json',
      'supervise',
      'force',
      'reclaim-stale-lock',
      'data-root',
      'yes'
    ],
    notes: [
      'Runs in the foreground and prints the bound endpoint, advertised endpoint, and pairing status. Stop it with Ctrl+C.',
      'With --port, serve exits with an error when that port is already in use. Without it, serve uses 6768 and moves to another port when 6768 is taken.',
      '--pairing-address changes only the client-advertised address; use a reachable LAN, Tailscale, SSH-forward, or reverse-proxy endpoint.',
      'Use --recipe-json with --project-root from VM recipes to print the recipe result JSON and leave the server running.',
      'Use --mobile-pairing to print a mobile-scoped pairing QR/link instead of the default runtime-environment pairing link.',
      "A paired client cannot drive this machine's desktop (madang computer) unless the offer was created with --grant-desktop-control.",
      'When the web client bundle is available, the server also prints a browser URL with the pairing data embedded.',
      'Exits with code 3, without starting anything, when another Madang already serves this profile or cannot be shown to have stopped.',
      "--reclaim-stale-lock starts nothing. When a start refuses because this profile's lock may belong to a Madang on another machine sharing this home (for example after a reboot, on a network home), it checks that the lock was written on a host with this name in an earlier boot, is at least 2 minutes old, and that nothing answers on this machine at its holder's endpoints. Those checks cannot rule out another machine with the same host name, so it then only prints what it found (exit 2); add --yes, once you are sure no other machine sharing this home runs Madang for this profile, to clear it (exit 0). It exits 1 when a check fails and 4 when there is no lock. --data-root names the data root the refusal printed. --json prints the status (none, eligible, refused or reclaimed). Linux only.",
      'On macOS, after Madang serve aborts at startup (it could not register with Launch Services), later runs from the same environment refuse for 30 minutes with exit code 78. Use --force to try anyway.',
      '--supervise is for service managers (launchd, systemd). Madang serve then restarts the server itself with growing delays instead of exiting when it stops, waits while an update replaces the app, and waits while another Madang serves this profile. After 6 failures in 15 minutes it gives up and exits with code 0 so the manager stops too, and later supervised runs refuse until a new build is installed or --force is passed. Not available on Windows yet.',
      'Experimental and off by default: set MADANG_TERMINAL_PROCESS_CEILING=<n> (64 or more) before the terminal host starts to have the OS cap how many processes each terminal may run (Linux, through a systemd user scope per terminal, which needs a user manager that outlives logout; Windows, through a job per terminal). `madang serve` reports the ceiling as on or off, with the reason.',
      'Off by default: set MADANG_TERMINAL_MEMORY_MAX=<size> (256M or more) and MADANG_TERMINAL_MEMORY_SWAP_MAX=<size> (0 for no swap) before the terminal host starts to cap the memory and swap of each terminal on Linux, through the same per-terminal systemd user scope. A terminal over its limit has its largest process OOM-killed; the host and other terminals keep running. Sizes take K, M, G or T. A limit the host cannot enforce is skipped and logged in the terminal host log. No effect on macOS or Windows.'
    ],
    examples: [
      'madang serve',
      'madang serve --json',
      'madang serve --project-root /workspace/repo --pairing-address wss://sandbox.example.com --recipe-json',
      'madang serve --port 6768 --pairing-address 100.64.1.20',
      'madang serve --pairing-address 100.64.1.20 --mobile-pairing',
      'madang serve --reclaim-stale-lock'
    ]
  },
  {
    path: ['serve', 'restore', 'resume'],
    summary: 'Resume automatic terminal restores that this host paused',
    usage: 'madang serve restore resume [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'After its terminal host stops unexpectedly, or while it is overloaded, Madang keeps restored agent sessions asleep instead of starting them all at once. Each one resumes when you open it.',
      'This clears that pause so automatic restores start again, within the normal limits. It talks to the Madang running on this machine and never starts a server.',
      'It also lists restores from an older Madang client that this host refused, with the command that resumes each one.'
    ],
    examples: ['madang serve restore resume', 'madang serve restore resume --json']
  },
  {
    path: ['serve', 'service', 'install'],
    summary: 'Run madang serve as a per-user background service that restarts itself',
    usage:
      'madang serve service install [--port <port>] [--pairing-address <host>] [--command <path>] [--dry-run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'port', 'pairing-address', 'command', 'dry-run'],
    notes: [
      'macOS writes a LaunchAgent; Linux writes a systemd user unit. Both run `madang serve --supervise --no-pairing` for this profile, so the server restarts with growing delays and gives up after repeated failures instead of looping.',
      'The service never prints a pairing link to its log. Pair clients from the desktop app, or with `madang serve` in a terminal while the service is stopped.',
      'On Linux the service stops at logout unless lingering is on (`loginctl enable-linger`); install reports it.',
      "Reinstalling replaces the unit and clears a previous give-up. --command defaults to the installed Madang app's `madang` command on PATH (`madang-ide` on Linux) and must not be a launcher tied to one Madang version. --dry-run prints the unit without installing it.",
      "Needs the Madang app installed on this machine. The `madang` command in a Madang terminal on an SSH host belongs to that connection's server and cannot install a service.",
      'Not available on Windows yet.'
    ],
    examples: ['madang serve service install', 'madang serve service install --port 6768 --dry-run']
  },
  {
    path: ['serve', 'service', 'status'],
    summary: "Show whether this profile's madang serve service is running",
    usage: 'madang serve service status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Reports live, exited, or unverifiable (when the service manager cannot be asked), plus why the supervisor gave up if it did.'
    ],
    examples: ['madang serve service status', 'madang serve service status --json']
  },
  {
    path: ['serve', 'service', 'uninstall'],
    summary: "Stop and remove this profile's madang serve service",
    usage: 'madang serve service uninstall [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Stops the service and removes its unit file. The terminal daemon and its sessions keep running.'
    ],
    examples: ['madang serve service uninstall']
  }
]
