import { homedir } from 'node:os'
import type { CommandHandler } from '../dispatch'
import { writeStdoutLine } from '../stdout-line'
import { getDefaultUserDataPath } from '../runtime/metadata'
import { loadCanonicalGuides } from './bundled-skill-guide-table'
import { SKILL_GUIDE_GET_HANDLER } from './skill-guide-get'
import { createSkillMutationHandler } from './bundled-skill-install-command'
import {
  localBundledSkillInput,
  previewBundledSkillInstall
} from '../../main/skills/bundled-skill-install/cli-entry'
import { bundledSkillInstalledState, type BundledSkillInstalledState } from '../../shared/bundled-skill-summary'

/** Installed state of every shipped skill on this machine's global agent folders. */
async function installedStates(): Promise<Map<string, BundledSkillInstalledState>> {
  const input = await localBundledSkillInput({
    userDataPath: getDefaultUserDataPath(),
    destination: { scope: 'global', homeDirectory: homedir() },
    selection: {}
  })
  const plan = await previewBundledSkillInstall(input)
  return new Map(plan.skills.map((entry) => [entry.name, bundledSkillInstalledState(entry)]))
}

export const SKILL_HANDLERS: Record<string, CommandHandler> = {
  'skills list': async ({ flags, json }) => {
    // Canonical sorting keeps output stable across generated-registry changes.
    const topics = (await loadCanonicalGuides()).map((guide) => ({
      name: guide.name,
      description: guide.description.replace(/\s+/g, ' ').trim()
    }))
    const states = flags.get('installed') === true ? await installedStates() : null
    const rows = topics.map((topic) =>
      states ? { ...topic, installed: states.get(topic.name) ?? 'guide-only' } : topic
    )
    writeStdoutLine(
      json
        ? JSON.stringify({ topics: rows }, null, 2)
        : [
            ...rows.map((row) =>
              'installed' in row
                ? `${row.name} [${row.installed}]: ${row.description}`
                : `${row.name}: ${row.description}`
            ),
            ...(states
              ? []
              : ['', 'These are the skills Madang ships. Add --installed to see which are installed.'])
          ].join('\n')
    )
  },
  ...SKILL_GUIDE_GET_HANDLER,
  'skills install': createSkillMutationHandler('install'),
  'skills update': createSkillMutationHandler('update')
}
