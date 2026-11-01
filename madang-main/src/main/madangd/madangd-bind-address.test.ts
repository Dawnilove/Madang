import { describe, expect, it } from 'vitest'
import {
  bindHostIsNetworkExposed,
  describeMadangdBindExposure,
  MADANGD_LOOPBACK_BIND_HOST,
  MadangdBindAddressError,
  resolveMadangdBindHost
} from './madangd-bind-address'

describe('resolveMadangdBindHost', () => {
  it('defaults to loopback when the operator asked for nothing', () => {
    expect(resolveMadangdBindHost()).toBe(MADANGD_LOOPBACK_BIND_HOST)
    expect(MADANGD_LOOPBACK_BIND_HOST).toBe('127.0.0.1')
  })

  it('accepts literal IPv4 and IPv6 addresses, including explicit wide binds', () => {
    expect(resolveMadangdBindHost('0.0.0.0')).toBe('0.0.0.0')
    expect(resolveMadangdBindHost('10.1.2.3')).toBe('10.1.2.3')
    expect(resolveMadangdBindHost('::1')).toBe('::1')
    expect(resolveMadangdBindHost('localhost')).toBe('127.0.0.1')
    expect(resolveMadangdBindHost(' 127.0.0.1 ')).toBe('127.0.0.1')
  })

  it('refuses hostnames, because DNS would decide which interface got bound', () => {
    expect(() => resolveMadangdBindHost('internal.example')).toThrow(MadangdBindAddressError)
    expect(() => resolveMadangdBindHost('')).toThrow(MadangdBindAddressError)
    expect(() => resolveMadangdBindHost('0.0.0.0:80')).toThrow(MadangdBindAddressError)
  })
})

describe('bindHostIsNetworkExposed', () => {
  it('separates local-only addresses from network-reachable ones', () => {
    expect(bindHostIsNetworkExposed('127.0.0.1')).toBe(false)
    expect(bindHostIsNetworkExposed('127.5.5.5')).toBe(false)
    expect(bindHostIsNetworkExposed('::1')).toBe(false)
    expect(bindHostIsNetworkExposed('0.0.0.0')).toBe(true)
    expect(bindHostIsNetworkExposed('::')).toBe(true)
    expect(bindHostIsNetworkExposed('10.1.2.3')).toBe(true)
  })

  it('says out loud when a deployment is reachable from the network', () => {
    expect(describeMadangdBindExposure('0.0.0.0')).toContain('reachable from the network')
    expect(describeMadangdBindExposure('127.0.0.1')).toContain('local only')
  })
})
