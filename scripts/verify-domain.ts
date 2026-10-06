import { seedState } from '../src/lib/seed'
import {
  actOnReviewInState,
  lockVersionInState,
  mergeDraftIntoState,
  rebaseReviewInState,
  resolveDivergenceInState,
  unlockNextRevisionInState,
  validateCurriculum,
  type CurriculumSlice,
} from '../src/lib/domain'

let passed = 0
let failed = 0
function check(name: string, condition: boolean, extra = '') {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`) }
  else { failed += 1; console.error(`  ✗ ${name} ${extra}`) }
}

const reviewer = { name: '周岚', role: '院系审阅人' } as const
const lead = { name: '顾明', role: '课程负责人' } as const
const base = (): CurriculumSlice => structuredClone({ ...seedState, draft: undefined }) as unknown as CurriculumSlice

// 1. 网络未恢复时合并失败，原草稿与待处理项保留，可重试
{
  const state = { ...base(), online: false }
  const result = mergeDraftIntoState(state, '2026-10-06 09:00')
  check('离线时合并失败', !result.ok)
  check('失败原因提示网络未恢复', result.message.includes('网络未恢复'))
  check('草稿保留且标记合并失败', result.next.offlineDraft?.status === '合并失败' && result.next.offlineDraft.changes.length === 3)
  check('待处理修订不受影响', result.next.mappings === state.mappings && result.next.divergences.length === 0)
  check('尝试次数递增', result.next.offlineDraft?.attempts === 1)
}

// 2. 草稿含未注册节点 → 校验失败，可修正后重试
{
  const state = base()
  const first = mergeDraftIntoState(state, '2026-10-06 09:05')
  check('含 C-999 的草稿校验失败', !first.ok && first.message.includes('C-999'))
  const fixed: CurriculumSlice = {
    ...state,
    offlineDraft: { ...first.next.offlineDraft!, changes: first.next.offlineDraft!.changes.filter((c) => c.target !== 'C-999') },
  }
  const retry = mergeDraftIntoState(fixed, '2026-10-06 09:10')
  check('清理后重试成功', retry.ok)
  check('无冲突修改直接并入（GR-01→C-205）', retry.applied.some((m) => m.source === 'GR-01' && m.target === 'C-205' && m.weight === 0.75))
  check('版本升级 R12→R13', retry.next.revision === 'R13')
  check('冲突修改登记为待审阅分歧', retry.newDivergences.length === 1 && retry.newDivergences[0].status === '待审阅')
  const confirmed = retry.next.mappings.filter((m) => m.source === 'GR-06' && m.target === 'C-308')
  check('已确认的毕业要求覆盖未被盖掉', confirmed.length === 2 && confirmed.every((m) => m.weight === 0.7))
  check('重试后未重复生成审阅记录', retry.next.divergences.length === 1)
}

// 3. 幂等：已合并草稿再次合并被拒绝，不重复生成记录
{
  const state = base()
  const fixed: CurriculumSlice = { ...state, offlineDraft: { ...state.offlineDraft!, changes: state.offlineDraft!.changes.slice(0, 2) } }
  const merged = mergeDraftIntoState(fixed, '2026-10-06 09:10')
  const after: CurriculumSlice = { ...state, ...merged.next }
  const again = mergeDraftIntoState(after, '2026-10-06 09:20')
  check('重复合并被拒绝', !again.ok && again.message.includes('已合并'))
  check('分歧记录不重复', after.divergences.length === 1)
}

// 4. 分歧裁决：越权拒绝；保留院系版不动映射；采用草稿版升版本
{
  const state = base()
  const fixed: CurriculumSlice = { ...state, offlineDraft: { ...state.offlineDraft!, changes: state.offlineDraft!.changes.slice(0, 2) } }
  const merged = mergeDraftIntoState(fixed, '2026-10-06 09:10')
  const after: CurriculumSlice = { ...state, ...merged.next }
  const divId = merged.newDivergences[0].id

  const denied = resolveDivergenceInState(after, divId, 'take', '', lead)
  check('课程负责人裁决分歧被拒绝', !denied.ok && denied.message.includes('越权'))

  const kept = resolveDivergenceInState(after, divId, 'keep', '院系版证据更充分。', reviewer)
  check('审阅人可保留院系版', kept.ok && kept.next?.revision === 'R13')
  check('保留后不能重复裁决', !resolveDivergenceInState({ ...after, ...kept.next! }, divId, 'take', '', reviewer).ok)

  const taken = resolveDivergenceInState(after, divId, 'take', '评分记录已补齐。', reviewer)
  check('采用草稿版后映射更新且版本升级', taken.ok && taken.next?.revision === 'R14')
  const pair = taken.next!.mappings.filter((m) => m.source === 'GR-06' && m.target === 'C-308')
  check('同一对映射只保留一条且为草稿版', pair.length === 1 && pair[0].weight === 0.9)
  check('重复映射警告随重算消失', !validateCurriculum({ nodes: after.nodes, mappings: taken.next!.mappings }).some((i) => i.id.startsWith('dup-')))
}

// 5. 旧修订不能再附议；退回允许；重报后可附议；越权直接拒绝
{
  const state = base()
  const fixed: CurriculumSlice = { ...state, offlineDraft: { ...state.offlineDraft!, changes: state.offlineDraft!.changes.slice(0, 1) } }
  const merged = mergeDraftIntoState(fixed, '2026-10-06 09:10')
  const after: CurriculumSlice = { ...state, ...merged.next } // 版本升至 R13

  const deniedRole = actOnReviewInState(after, 'REV-201', '已附议', '同意。', lead)
  check('课程负责人越权附议直接拒绝', !deniedRole.ok && deniedRole.message.includes('越权'))

  const stale = actOnReviewInState(after, 'REV-201', '已附议', '同意。', reviewer)
  check('旧修订附议被拒绝', !stale.ok && stale.message.includes('旧修订不能再附议'))

  const returned = actOnReviewInState(after, 'REV-201', '已退回', '请按 R13 重报。', reviewer)
  check('旧修订可退回', returned.ok)

  const rebased = rebaseReviewInState(after, 'REV-202', lead)
  check('课程负责人可按当前版本重报', rebased.ok && rebased.next?.reviewItems.find((i) => i.id === 'REV-202')?.baseRevision === 'R13')
  const afterRebase: CurriculumSlice = { ...after, ...rebased.next! }
  const approved = actOnReviewInState(afterRebase, 'REV-202', '已附议', '证据充分。', reviewer)
  check('重报后可附议', approved.ok)

  const decided: CurriculumSlice = { ...afterRebase, ...approved.next! }
  check('已审阅记录不能重复处理', !actOnReviewInState(decided, 'REV-202', '已退回', '再退。', reviewer).ok)
}

// 6. 锁定版本归档可查；重复锁定拒绝；解锁升版本
{
  const state = base()
  const locked = lockVersionInState(state, '2026-10-06 10:00')
  check('锁定成功并归档快照', locked.ok && locked.next?.lockedVersions[0].revision === 'R12')
  check('快照含考核证据', locked.next!.lockedVersions[0].reviewItems.some((i) => i.id === 'REV-203'))
  const after: CurriculumSlice = { ...state, ...locked.next! }
  check('重复锁定被拒绝', !lockVersionInState(after, '2026-10-06 10:01').ok)
  const unlocked = unlockNextRevisionInState(after)
  check('解锁后开启 R13', unlocked.ok && unlocked.next?.revision === 'R13' && unlocked.next.locked === false)
  check('既有锁定版本（R11）证据照旧可查', after.lockedVersions.some((v) => v.revision === 'R11' && v.reviewItems.length > 0))
}

// 7. 覆盖矩阵与缺口提示随映射变化重算
{
  const state = base()
  const before = validateCurriculum(state)
  check('初始存在重复映射警告', before.some((i) => i.id.startsWith('dup-')))
  const removed: CurriculumSlice = { ...state, mappings: state.mappings.filter((m) => !(m.source === 'GR-01' && m.target === 'C-101')) }
  const after = validateCurriculum(removed)
  check('删除映射后出现 GR-01 覆盖缺口', after.some((i) => i.id === 'coverage-GR-01' && i.severity === '错误'))
}

console.log(`\n${passed} 通过, ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
