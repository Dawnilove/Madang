import { describe, expect, it } from 'vitest'
import {
  MADANG_PROJECT_DIR_NAME,
  MADANG_YAML_FILE_NAME,
  ORCA_COMPAT_PROJECT_DIR_NAME,
  ORCA_COMPAT_YAML_FILE_NAME,
  pickMadangOrCompatName
} from './orca-compat-yaml'

const pick = (present: string[]): string =>
  pickMadangOrCompatName(MADANG_YAML_FILE_NAME, ORCA_COMPAT_YAML_FILE_NAME, (n) =>
    present.includes(n)
  )

describe('orca-compat-yaml', () => {
  it('names the Madang and Orca files', () => {
    expect(MADANG_YAML_FILE_NAME).toBe('madang.yaml')
    expect(ORCA_COMPAT_YAML_FILE_NAME).toBe('orca.yaml')
    expect(MADANG_PROJECT_DIR_NAME).toBe('.madang')
    expect(ORCA_COMPAT_PROJECT_DIR_NAME).toBe('.orca')
  })

  it('picks madang.yaml when only it exists', () => {
    expect(pick(['madang.yaml'])).toBe('madang.yaml')
  })

  it('falls back to orca.yaml when only it exists', () => {
    expect(pick(['orca.yaml'])).toBe('orca.yaml')
  })

  it('picks madang.yaml when both exist', () => {
    expect(pick(['orca.yaml', 'madang.yaml'])).toBe('madang.yaml')
  })

  it('answers with the Madang name when neither exists, so new files use it', () => {
    expect(pick([])).toBe('madang.yaml')
  })
})
