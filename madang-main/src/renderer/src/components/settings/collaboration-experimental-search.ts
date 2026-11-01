import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export const getCollaborationExperimentalSearchEntry = createLocalizedCatalog(
  (): SettingsSearchEntry => ({
    title: translate(
      'auto.components.settings.collaborationExperimental.title',
      'Collaboration rules'
    ),
    description: translate(
      'auto.components.settings.collaborationExperimental.description',
      'When on, an agent session whose first message starts with "협업" follows the multi-agent collaboration rules: it becomes the lead, assigns roles to the connected agents, and sends work orders to worker sessions.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.0d24759f14',
        'experimental'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.collaborationExperimental.keywordCollaboration',
        'collaboration'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.collaborationExperimental.keywordOrchestration',
        'orchestration'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.collaborationExperimental.keywordRoles',
        'roles'
      )
    ],
    targetSectionId: 'collaboration-rules'
  })
)
