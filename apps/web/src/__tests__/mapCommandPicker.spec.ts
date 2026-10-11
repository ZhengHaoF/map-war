import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MapCommandPicker from '@/components/MapCommandPicker.vue'
import { MAP_COMMAND_CANDIDATE_COLOR } from '@/composables/useMapCommand'

describe('two-step map selection prompt', () => {
  it.each(['battle', 'moveTroops'] as const)('shows the exact source then target instruction for %s', async kind => {
    const action = kind === 'battle' ? '进攻' : '调兵'
    const wrapper = mount(MapCommandPicker, { props: {
      kind, phase: 'pickingSource', sourceName: '', candidateCount: 8, error: '',
    } })
    expect(wrapper.get('[role="status"]').text()).toContain(`请选择${action}城市`)
    expect(wrapper.text()).toContain('黄色高亮：8 座己方可选城市')
    expect(wrapper.text()).toContain('1 / 2')
    expect(wrapper.text()).not.toContain('用下拉选择')
    expect(wrapper.findAll('button').map(b => b.text())).toEqual(['取消 · Esc'])
    await wrapper.setProps({ phase: 'pickingTarget', sourceName: '宜宾', candidateCount: 3 })
    expect(wrapper.get('[role="status"]').text()).toContain(`请选择${action}目标城市`)
    expect(wrapper.text()).toContain('出发城：宜宾')
    expect(wrapper.text()).toContain('黄色高亮：3 座可选目标城市')
    expect(wrapper.text()).toContain('蓝色为出发城')
    expect(wrapper.text()).toContain('2 / 2')
    await wrapper.findAll('button').find(b => b.text() === '重选出发城')!.trigger('click')
    expect(wrapper.emitted('restart')).toHaveLength(1)
    await wrapper.findAll('button').find(b => b.text() === '取消 · Esc')!.trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    wrapper.unmount()
  })
  it('explains an empty candidate set and preserves visible invalid-click feedback', () => {
    const wrapper = mount(MapCommandPicker, { props: {
      kind: 'battle', phase: 'pickingTarget', sourceName: '宜宾',
      candidateCount: 0, error: '进攻目标必须是非己方城市',
    } })
    expect(wrapper.text()).toContain('当前没有符合路线、归属及外交条件的目标')
    expect(wrapper.text()).toContain('进攻目标必须是非己方城市')
    expect(wrapper.text()).toContain('地图选择不发兵、不扣费')
    wrapper.unmount()
  })
  it('uses the requested yellow rather than the old green candidate color', () => {
    expect(MAP_COMMAND_CANDIDATE_COLOR).toBe(0xf6cc38)
  })
})
