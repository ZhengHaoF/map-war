/**
 * commsEntity 单测
 * 覆盖：normalizeCommsFrom / resolveEntity（势力/国家/系统）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { normalizeCommsFrom, resolveEntity } from '../utils/commsEntity'
import { Owner, OWNER_LABELS, OWNER_DETAILS, OWNER_COLORS } from '@/data/owners'

// mock useGameStore
const mockIsAlive = vi.fn()
const mockFactionCities = vi.fn()
const mockFactionTroops = vi.fn()

vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    isAlive: mockIsAlive,
    factionCities: mockFactionCities,
    factionTroops: mockFactionTroops,
  }),
}))

beforeEach(() => {
  mockIsAlive.mockReset()
  mockFactionCities.mockReset()
  mockFactionTroops.mockReset()
})

describe('normalizeCommsFrom', () => {
  it('裸 Owner 代号原样返回', () => {
    expect(normalizeCommsFrom('KMT')).toBe('KMT')
    expect(normalizeCommsFrom('CCP')).toBe('CCP')
  })

  it('country: / country_ 前缀原样返回', () => {
    expect(normalizeCommsFrom('country:JPN')).toBe('country:JPN')
    expect(normalizeCommsFrom('country_JPN')).toBe('country_JPN')
  })

  it('势力中文名 → Owner 代号', () => {
    expect(normalizeCommsFrom('国民政府')).toBe('KMT')
    expect(normalizeCommsFrom('中共苏区')).toBe('CCP')
  })

  it('国家中文名 → country_ISO', () => {
    expect(normalizeCommsFrom('日本')).toBe('country_JPN')
    expect(normalizeCommsFrom('苏联')).toBe('country_SUN')
  })

  it('未知字符串原样返回', () => {
    expect(normalizeCommsFrom('unknown')).toBe('unknown')
  })

  it('空字符串原样返回', () => {
    expect(normalizeCommsFrom('')).toBe('')
  })
})

describe('resolveEntity', () => {
  describe('系统实体', () => {
    it('WORLD → 世界频道', () => {
      const e = resolveEntity('WORLD')
      expect(e.kind).toBe('system')
      expect(e.code).toBe('WORLD')
      expect(e.name).toBe('世界频道')
      expect(e.label).toBe('世界')
      expect(e.alive).toBe(true)
    })

    it('PLAYER → 玩家', () => {
      const e = resolveEntity('PLAYER')
      expect(e.kind).toBe('system')
      expect(e.code).toBe('PLAYER')
      expect(e.name).toBe('玩家')
      expect(e.alive).toBe(true)
    })
  })

  describe('国家实体', () => {
    it('country:JPN → 日本国家实体', () => {
      const e = resolveEntity('country:JPN')
      expect(e.kind).toBe('country')
      expect(e.code).toBe('JPN')
      // name 优先取 COUNTRY_COMMS.leader
      expect(e.name).toBe('犬养毅')
      expect(e.label).toBe('日本')
    })

    it('country_JPN → 日本国家实体（下划线形式）', () => {
      const e = resolveEntity('country_JPN')
      expect(e.kind).toBe('country')
      expect(e.code).toBe('JPN')
    })

    it('国家颜色 fallback 为 #666', () => {
      const e = resolveEntity('country:UNK')
      expect(e.colorHex).toBe('#666')
    })
  })

  describe('势力实体', () => {
    beforeEach(() => {
      mockIsAlive.mockReturnValue(true)
      mockFactionCities.mockReturnValue([{ gb: '1' }, { gb: '2' }])
      mockFactionTroops.mockReturnValue(150)
    })

    it('存活势力返回正确信息', () => {
      const e = resolveEntity('KMT')
      expect(e.kind).toBe('faction')
      expect(e.code).toBe('KMT')
      expect(e.name).toBe(OWNER_DETAILS.KMT.leader)
      expect(e.label).toBe(OWNER_LABELS.KMT)
      expect(e.colorHex).toBe('#' + OWNER_COLORS.KMT.toString(16).padStart(6, '0'))
      expect(e.alive).toBe(true)
      expect(e.status).toContain('2城')
      expect(e.status).toContain('150k')
    })

    it('已覆灭势力显示已覆灭', () => {
      mockIsAlive.mockReturnValue(false)
      const e = resolveEntity('SHX')
      expect(e.alive).toBe(false)
      expect(e.status).toBe('已覆灭')
    })

    it('未知势力 fallback', () => {
      mockIsAlive.mockReturnValue(false)
      const e = resolveEntity('UNKNOWN')
      expect(e.kind).toBe('faction')
      expect(e.code).toBe('UNKNOWN')
      expect(e.label).toBe('UNKNOWN')
    })
  })
})
