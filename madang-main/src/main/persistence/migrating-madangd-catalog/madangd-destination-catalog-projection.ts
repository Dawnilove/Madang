import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { Repo } from '../../../shared/repo-types'

export function toMadangdDestinationRepository(source: Repo): Repo {
  const destination = structuredClone(source)
  delete destination.connectionId
  delete destination.executionHostId
  return destination
}

export function toMadangdDestinationProjectGroup(source: ProjectGroup): ProjectGroup {
  const destination = structuredClone(source)
  destination.connectionId = null
  delete destination.executionHostId
  return destination
}

export function toMadangdDestinationFolderWorkspace(source: FolderWorkspace): FolderWorkspace {
  const destination = structuredClone(source)
  destination.connectionId = null
  delete destination.executionHostId
  destination.linkedTaskSourceContext ??= null
  return destination
}
