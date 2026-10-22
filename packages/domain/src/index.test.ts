import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from './index'

describe('domain', () => {
  it('exposes a positive schema version', () => {
    expect(SCHEMA_VERSION).toBeGreaterThan(0)
  })
})
