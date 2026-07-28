/**
 * aiParse 纯函数单测
 * 覆盖：extractJson / unwrapData / isUnifiedResult / extractPayloads /
 *       isFreeActionResult / extractAiMessage / pickOrderArray
 */
import { describe, it, expect } from 'vitest'
import {
  extractJson,
  unwrapData,
  isUnifiedResult,
  extractPayloads,
  isFreeActionResult,
  extractAiMessage,
  pickOrderArray,
} from '../utils/aiParse'

describe('extractJson', () => {
  it('裸 JSON 对象', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('裸 JSON 数组', () => {
    expect(extractJson('[1,2,3]')).toEqual([1, 2, 3])
  })

  it('markdown fence 包裹', () => {
    const input = '```json\n{"a":1}\n```'
    expect(extractJson(input)).toEqual({ a: 1 })
  })

  it('无 fence 但有前后缀文本（截断容错）', () => {
    expect(extractJson('abc {"a":1} xyz')).toEqual({ a: 1 })
  })

  it('深度思考标签 被剥除', () => {
    const input = '<think>balabala</think>\n{"a":1}'
    expect(extractJson(input)).toEqual({ a: 1 })
  })

  it('完全无法解析时抛错', () => {
    expect(() => extractJson('no json here')).toThrow('无法从 AI 回复中解析出 JSON')
  })
})

describe('unwrapData', () => {
  it('裸数组原样返回', () => {
    expect(unwrapData([{ order: 'fogCover' }])).toEqual([{ order: 'fogCover' }])
  })

  it('{orders:[...]} 解包', () => {
    expect(unwrapData({ orders: [{ order: 'fogCover' }] })).toEqual([{ order: 'fogCover' }])
  })

  it('{data:[...]} 解包', () => {
    expect(unwrapData({ data: [{ order: 'fogCover' }] })).toEqual([{ order: 'fogCover' }])
  })

  it('数组内含 wrapped 对象：逐项解包', () => {
    const input = [
      { orders: [{ order: 'a' }] },
      { data: [{ order: 'b' }] },
      { order: 'c' },
    ]
    expect(unwrapData(input)).toEqual([{ order: 'a' }, { order: 'b' }, { order: 'c' }])
  })

  it('普通对象无 orders/data 键：原样返回', () => {
    expect(unwrapData({ msg: 'hi' })).toEqual({ msg: 'hi' })
  })
})

describe('isUnifiedResult', () => {
  it('有 results 且无 orders → true', () => {
    expect(isUnifiedResult({ results: [{ order: {}, verdict: 'feasible', reason: '' }] })).toBe(true)
  })

  it('有 orders → false', () => {
    expect(isUnifiedResult({ orders: [], results: [] })).toBe(false)
  })

  it('null / 数组 / 字符串 → false', () => {
    expect(isUnifiedResult(null)).toBe(false)
    expect(isUnifiedResult([])).toBe(false)
    expect(isUnifiedResult('string')).toBe(false)
  })

  it('results 不是数组 → false', () => {
    expect(isUnifiedResult({ results: 'not-array' })).toBe(false)
  })
})

describe('extractPayloads', () => {
  it('content 含 JSON：抽取并解析', () => {
    const raw = {
      choices: [{ message: { content: '{"a":1}' } }],
    }
    expect(extractPayloads(raw)).toEqual([{ a: 1 }])
  })

  it('tool_calls.arguments 含 JSON：抽取并解析', () => {
    const raw = {
      choices: [{
        message: {
          content: '',
          tool_calls: [{ function: { arguments: '{"b":2}' } }],
        },
      }],
    }
    expect(extractPayloads(raw)).toEqual([{ b: 2 }])
  })

  it('content 与 tool_calls 并存：两者都抽取', () => {
    const raw = {
      choices: [{
        message: {
          content: '{"a":1}',
          tool_calls: [{ function: { arguments: '{"b":2}' } }],
        },
      }],
    }
    expect(extractPayloads(raw)).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('content 非 JSON：跳过（不抛错）', () => {
    const raw = { choices: [{ message: { content: 'plain text' } }] }
    expect(extractPayloads(raw)).toEqual([])
  })

  it('tool_calls arguments 坏 JSON：跳过', () => {
    const raw = {
      choices: [{
        message: {
          content: '',
          tool_calls: [{ function: { arguments: 'not-json' } }],
        },
      }],
    }
    expect(extractPayloads(raw)).toEqual([])
  })
})

describe('isFreeActionResult', () => {
  const valid = {
    freeAction: {
      narrative: 'some story',
      success: true,
      effects: [],
    },
  }

  it('合法 freeAction → true', () => {
    expect(isFreeActionResult(valid)).toBe(true)
  })

  it('null / 数组 / 字符串 → false', () => {
    expect(isFreeActionResult(null)).toBe(false)
    expect(isFreeActionResult([])).toBe(false)
    expect(isFreeActionResult('str')).toBe(false)
  })

  it('缺 narrative 字段 → false', () => {
    expect(isFreeActionResult({ freeAction: { success: true, effects: [] } })).toBe(false)
  })

  it('effects 不是数组 → false', () => {
    expect(isFreeActionResult({ freeAction: { narrative: 'x', success: true, effects: {} } })).toBe(false)
  })
})

describe('extractAiMessage', () => {
  it('有 msg 字段返回 trimmed 字符串', () => {
    expect(extractAiMessage({ msg: '  hello world  ' })).toBe('hello world')
  })

  it('无 msg 字段返回 null', () => {
    expect(extractAiMessage({ orders: [] })).toBeNull()
  })

  it('msg 为空字符串返回 null', () => {
    expect(extractAiMessage({ msg: '' })).toBeNull()
  })

  it('null / 数组返回 null', () => {
    expect(extractAiMessage(null)).toBeNull()
    expect(extractAiMessage([])).toBeNull()
  })
})

describe('pickOrderArray', () => {
  it('{orders:[...]} 返回数组', () => {
    expect(pickOrderArray({ orders: [1, 2] })).toEqual([1, 2])
  })

  it('{data:[...]} 返回数组', () => {
    expect(pickOrderArray({ data: [3, 4] })).toEqual([3, 4])
  })

  it('无 orders/data → null', () => {
    expect(pickOrderArray({ msg: 'hi' })).toBeNull()
  })

  it('数组 / null → null', () => {
    expect(pickOrderArray([1])).toBeNull()
    expect(pickOrderArray(null)).toBeNull()
  })
})
