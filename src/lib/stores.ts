import { writable } from 'svelte/store'
import { browser } from '$app/environment'
import type { Mapping, MappingEdit, Role } from './seed'
import { seedState } from './seed'
import {
  actOnReviewInState,
  lockVersionInState,
  mergeDraftIntoState,
  rebaseReviewInState,
  resolveDivergenceInState,
  timestamp,
  unlockNextRevisionInState,
  validateCurriculum,
  type CurriculumSlice,
} from './domain'

export { validateCurriculum }

type CurriculumState = CurriculumSlice & {
  /** 课程负责人的离线文字草稿 */
  draft: string
}

const STORAGE_KEY = 'curriculum-map-v2'
const saved = browser ? localStorage.getItem(STORAGE_KEY) : null
const initial: CurriculumState = saved ? JSON.parse(saved) : structuredClone(seedState)

function createCurriculumStore() {
  const { subscribe, update, set } = writable<CurriculumState>({ ...initial, draft: initial.draft ?? 'C-308 对 GR-06 的案例证据不足，需补充评分记录。' })
  return {
    subscribe,
    set,
    update,
    moveNode(id: string, x: number, y: number) {
      update((state) => ({ ...state, nodes: state.nodes.map((node) => (node.id === id ? { ...node, x, y } : node)) }))
    },
    addMapping(source: string, target: string, relation: Mapping['relation'], weight: number) {
      update((state) => (state.locked ? state : { ...state, mappings: [...state.mappings, { id: `M-${Date.now()}`, source, target, relation, weight }] }))
    },
    setRole(role: Role) {
      update((state) => ({ ...state, actor: { name: role === '课程负责人' ? '顾明' : '周岚', role } }))
    },
    setOnline(online: boolean) {
      update((state) => ({ ...state, online }))
    },
    saveDraft(draft: string) {
      update((state) => ({ ...state, draft }))
    },
    /** 离线期间登记一条草稿修改（同一对映射后者覆盖前者，仅限草稿内部） */
    queueDraftChange(change: MappingEdit) {
      update((state) => {
        const base = state.offlineDraft && state.offlineDraft.status !== '已合并'
          ? state.offlineDraft
          : { id: `DRAFT-${Date.now().toString(36).toUpperCase()}`, group: `${state.actor.name} 课程组`, baseRevision: state.revision, updatedAt: '', status: '编辑中' as const, attempts: 0, lastError: '', changes: [] }
        const changes = [...base.changes.filter((item) => !(item.source === change.source && item.target === change.target)), change]
        return { ...state, offlineDraft: { ...base, changes, status: base.status === '合并失败' ? '合并失败' : '编辑中', updatedAt: timestamp() } }
      })
    },
    removeDraftChange(index: number) {
      update((state) => {
        if (!state.offlineDraft) return state
        const changes = state.offlineDraft.changes.filter((_, itemIndex) => itemIndex !== index)
        return { ...state, offlineDraft: { ...state.offlineDraft, changes, updatedAt: timestamp() } }
      })
    },
    /** 网络恢复后合并离线草稿；失败可重试，原草稿与待处理项保留 */
    mergeOfflineDraft() {
      let outcome!: ReturnType<typeof mergeDraftIntoState>
      update((state) => {
        outcome = mergeDraftIntoState(state, timestamp())
        const entry = { at: timestamp(), draftId: state.offlineDraft?.id ?? '-', ok: outcome.ok, message: outcome.message }
        return { ...state, ...outcome.next, mergeLog: [entry, ...state.mergeLog] }
      })
      return outcome
    },
    /** 院系审阅人逐条确认分歧保留哪一版 */
    resolveDivergence(id: string, choice: 'keep' | 'take', comment: string) {
      let outcome!: ReturnType<typeof resolveDivergenceInState>
      update((state) => {
        outcome = resolveDivergenceInState(state, id, choice, comment, state.actor)
        return outcome.next ? { ...state, ...outcome.next } : state
      })
      return outcome
    },
    /** 附议/退回：越权与旧修订在领域层直接拒绝 */
    actOnReview(id: string, decision: '已附议' | '已退回', comment: string) {
      let outcome!: ReturnType<typeof actOnReviewInState>
      update((state) => {
        outcome = actOnReviewInState(state, id, decision, comment, state.actor)
        return outcome.next ? { ...state, ...outcome.next } : state
      })
      return outcome
    },
    rebaseReview(id: string) {
      let outcome!: ReturnType<typeof rebaseReviewInState>
      update((state) => {
        outcome = rebaseReviewInState(state, id, state.actor)
        return outcome.next ? { ...state, ...outcome.next } : state
      })
      return outcome
    },
    /** 追加服务端返回的修订，按 ID 去重，不会重复生成审阅记录 */
    addReviewItem(item: CurriculumState['reviewItems'][number]) {
      update((state) => (state.reviewItems.some((entry) => entry.id === item.id) ? state : { ...state, reviewItems: [item, ...state.reviewItems] }))
    },
    lockVersion() {
      let outcome!: ReturnType<typeof lockVersionInState>
      update((state) => {
        outcome = lockVersionInState(state, timestamp())
        return outcome.next ? { ...state, ...outcome.next } : state
      })
      return outcome
    },
    unlockNextRevision() {
      let outcome!: ReturnType<typeof unlockNextRevisionInState>
      update((state) => {
        outcome = unlockNextRevisionInState(state)
        return outcome.next ? { ...state, ...outcome.next } : state
      })
      return outcome
    },
  }
}

export const curriculumStore = createCurriculumStore()

if (browser) {
  curriculumStore.subscribe((state) => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)))
}
