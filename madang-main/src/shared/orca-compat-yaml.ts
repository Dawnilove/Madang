// Madang reads the names Orca wrote into user repositories: the `orca.yaml` project file and the
// `.orca/` hidden folder. This file is the only place that names them. New files always use the
// Madang names; the Orca names are read only when no Madang file exists. Orca files are never
// renamed or deleted by the read path.

/** Project config file in the repository root. Written and shown to users. */
export const MADANG_YAML_FILE_NAME = 'madang.yaml'

/** Orca's name for the project config file. Read only when `madang.yaml` is absent. */
export const ORCA_COMPAT_YAML_FILE_NAME = 'orca.yaml'

/** Hidden project folder (issue-command, drops, templates). Written to. */
export const MADANG_PROJECT_DIR_NAME = '.madang'

/** Orca's name for the hidden project folder. Read only when `.madang/` is absent. */
export const ORCA_COMPAT_PROJECT_DIR_NAME = '.orca'

/** Madang name when `exists` accepts it, else the Orca name when `exists` accepts that, else Madang. */
export function pickMadangOrCompatName(
  madangName: string,
  compatName: string,
  exists: (name: string) => boolean
): string {
  if (exists(madangName)) {
    return madangName
  }
  return exists(compatName) ? compatName : madangName
}
