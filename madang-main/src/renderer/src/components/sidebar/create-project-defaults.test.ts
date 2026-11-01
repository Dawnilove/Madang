import { describe, expect, it } from 'vitest'
import {
  formatCreateProjectParentSummary,
  getCreateProjectDefaultParentAutoFill,
  getDefaultCreateProjectParent,
  joinCreateProjectPath
} from './create-project-defaults'

describe('create project defaults', () => {
  it('builds the POSIX default project parent', () => {
    expect(getDefaultCreateProjectParent('/Users/alice')).toBe('/Users/alice/madang/projects')
  })

  it('builds the Windows default project parent', () => {
    expect(getDefaultCreateProjectParent('C:\\Users\\alice')).toBe(
      'C:\\Users\\alice\\madang\\projects'
    )
  })

  it('derives the runtime project default from a resolved server home', () => {
    expect(getDefaultCreateProjectParent('/home/alice')).toBe('/home/alice/madang/projects')
  })

  it('joins path previews without mixing separators', () => {
    expect(joinCreateProjectPath('/home/alice/madang/projects', 'demo')).toBe(
      '/home/alice/madang/projects/demo'
    )
    expect(joinCreateProjectPath('C:\\Users\\alice\\madang\\projects', 'demo')).toBe(
      'C:\\Users\\alice\\madang\\projects\\demo'
    )
  })

  it('auto-fills only the first empty local create step', () => {
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '',
        activeRuntimeEnvironmentId: null,
        defaultParent: '/Users/alice/madang/projects',
        createStepAutoFilled: false
      })
    ).toEqual({ parent: '/Users/alice/madang/projects' })
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '/tmp/project',
        activeRuntimeEnvironmentId: null,
        defaultParent: '/Users/alice/madang/projects',
        createStepAutoFilled: false
      })
    ).toBeNull()
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '',
        activeRuntimeEnvironmentId: null,
        defaultParent: '/Users/alice/madang/projects',
        createStepAutoFilled: true
      })
    ).toBeNull()
  })

  it('does not apply a local default while a runtime environment is active', () => {
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '',
        activeRuntimeEnvironmentId: 'env-1',
        defaultParent: '/Users/alice/madang/projects',
        createStepAutoFilled: false
      })
    ).toBeNull()
  })

  it('uses a short local summary only for the local default parent', () => {
    expect(
      formatCreateProjectParentSummary({
        parent: '/Users/alice/madang/projects',
        defaultParent: '/Users/alice/madang/projects'
      })
    ).toBe('~/madang/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: '/home/alice/madang/projects',
        defaultParent: '/home/alice/madang/projects'
      })
    ).toBe('~/madang/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: 'C:\\Users\\alice\\madang\\projects',
        defaultParent: 'C:\\Users\\alice\\madang\\projects'
      })
    ).toBe('~/madang/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: '',
        defaultParent: '',
        runtimeEnvironmentId: 'env-1'
      })
    ).toBe('host folder not selected')
    expect(
      formatCreateProjectParentSummary({
        parent: '/Users/alice/madang/projects',
        defaultParent: '/Users/alice/madang/projects',
        isRemoteHost: true
      })
    ).toBe('/Users/alice/madang/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: '',
        defaultParent: '',
        isRemoteHost: true
      })
    ).toBe('host folder not selected')
  })

  it('keeps a configured Workspace Directory verbatim in the summary', () => {
    expect(
      formatCreateProjectParentSummary({
        parent: 'J:\\PROJECTS',
        defaultParent: 'J:\\PROJECTS'
      })
    ).toBe('J:\\PROJECTS')
    expect(
      formatCreateProjectParentSummary({
        parent: '/data/madang/projects',
        defaultParent: '/data/madang/projects'
      })
    ).toBe('/data/madang/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: 'D:\\code\\orca\\projects',
        defaultParent: 'D:\\code\\orca\\projects'
      })
    ).toBe('D:\\code\\orca\\projects')
  })
})
