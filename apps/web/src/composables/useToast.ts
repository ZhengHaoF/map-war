/**
 * 轻量提示（Toast）队列 —— 模块级单例。
 *
 * 设计要点：
 * - 纯响应式队列（ref），不依赖任何 Vue 组件，可在 store / 组合式 / 指令层随意调用；
 * - 所有提示经由本队列，再由 ToastStack 统一渲染，保证「决定弹什么」与「怎么显示」解耦；
 * - 天然 replay 安全：本队列只在活事件/活操作里被 push，读档重放（applyEvent 直跑）不会触发；
 * - 超出上限自动挤掉最旧的一条，避免刷屏。
 */

import { ref } from 'vue'

/** 提示色调：与 EventLogPanel 的事件配色、羊皮纸主题变量保持一致 */
export type ToastTone =
  | 'cinnabar' // 朱砂：宣战 / 开战 / 占领 / 高优先提示
  | 'amber' // 琥珀：出兵进攻
  | 'blue' // 靛蓝：侦察
  | 'green' // 青绿：成功 / 读档成功
  | 'purple' // 紫：势力参战
  | 'neutral' // 褐：中性（停战 / 删档 / 日期）
  | 'error' // 危险红：失败 / 覆灭 / 异常

export interface ToastInput {
  /** tabler 图标名（见 GameToast 的图标注册表），如 'sword' / 'flag' */
  icon?: string
  /** 主标题（粗体，如「宣战」「占领」） */
  title: string
  /** 副文案（如「川军 → 晋系」） */
  text?: string
  /** 色调，决定左边框 / 图标颜色 */
  tone?: ToastTone
  /** 自动消失毫秒数；0 = 常驻（需手动关闭） */
  duration?: number
}

export interface ToastItem extends ToastInput {
  id: number
}

const toasts = ref<ToastItem[]>([])
let seq = 0
const MAX_STACK = 5
const DEFAULT_DURATION = 3400

/** 入队一条提示，返回其 id（可用于手动关闭） */
function push(input: ToastInput): number {
  const id = ++seq
  const duration = input.duration ?? DEFAULT_DURATION
  const item: ToastItem = {
    id,
    icon: input.icon,
    title: input.title,
    text: input.text,
    tone: input.tone ?? 'neutral',
    duration,
  }
  toasts.value.push(item)
  // 超出上限：挤掉最旧的一条
  if (toasts.value.length > MAX_STACK) toasts.value.shift()
  // 自动过期（duration>0 时）
  if (duration > 0) {
    window.setTimeout(() => dismiss(id), duration)
  }
  return id
}

/** 关闭指定提示 */
function dismiss(id: number): void {
  const i = toasts.value.findIndex((t) => t.id === id)
  if (i !== -1) toasts.value.splice(i, 1)
}

/** 清空全部（调试 / 读档切换时用） */
function clear(): void {
  toasts.value = []
}

export function useToast() {
  return { toasts, push, dismiss, clear }
}
