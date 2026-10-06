export type GraphNode = {
  id: string
  label: string
  type: '目标' | '毕业要求' | '课程' | '单元' | '教学活动' | '考核'
  x: number
  y: number
  course?: string
}

export type Mapping = {
  id: string
  source: string
  target: string
  relation: '支撑' | '前置' | '考核' | '教学'
  weight: number
}

export type ReviewItem = {
  id: string
  courseId: string
  requirementId: string
  evidence: string
  submitter: string
  status: '待审阅' | '已附议' | '已退回'
  comment: string
  /** 提交时基于的院系版本，映射变更后旧修订不能再附议 */
  baseRevision: string
}

export type Role = '课程负责人' | '院系审阅人'

export type Actor = { name: string; role: Role }

/** 离线草稿中的一条映射修改 */
export type MappingEdit = {
  source: string
  target: string
  relation: Mapping['relation']
  weight: number
  note: string
}

export type OfflineDraft = {
  id: string
  group: string
  /** 草稿开始时基于的院系版本 */
  baseRevision: string
  updatedAt: string
  status: '编辑中' | '待合并' | '合并失败' | '已合并'
  /** 合并尝试次数，失败重试不重置 */
  attempts: number
  lastError: string
  changes: MappingEdit[]
}

/** 待审阅分歧：后到的草稿修改与院系已确认覆盖冲突 */
export type Divergence = {
  id: string
  pairKey: string
  source: string
  target: string
  /** 院系已确认版本（不被草稿覆盖） */
  confirmed: Mapping
  /** 后到的草稿版本 */
  incoming: MappingEdit
  draftId: string
  group: string
  status: '待审阅' | '已保留院系版' | '已采用草稿版'
  comment: string
}

export type MergeLogEntry = {
  at: string
  draftId: string
  ok: boolean
  message: string
}

/** 锁定版本快照：考核证据照旧可查 */
export type LockedVersion = {
  revision: string
  lockedAt: string
  mappings: Mapping[]
  reviewItems: ReviewItem[]
}

export const nodes: GraphNode[] = [
  { id: 'OBJ-01', label: '培养目标 1\n服务区域数字产业', type: '目标', x: 70, y: 70 },
  { id: 'OBJ-02', label: '培养目标 2\n具备工程创新能力', type: '目标', x: 70, y: 210 },
  { id: 'GR-01', label: '毕业要求 1\n工程知识', type: '毕业要求', x: 310, y: 50 },
  { id: 'GR-03', label: '毕业要求 3\n设计解决方案', type: '毕业要求', x: 310, y: 180 },
  { id: 'GR-06', label: '毕业要求 6\n工程与社会', type: '毕业要求', x: 310, y: 310 },
  { id: 'C-101', label: '程序设计基础\nC-101', type: '课程', x: 570, y: 40 },
  { id: 'C-205', label: '数据结构与算法\nC-205', type: '课程', x: 570, y: 170 },
  { id: 'C-308', label: '软件工程实践\nC-308', type: '课程', x: 570, y: 300 },
  { id: 'U-205-02', label: '图与路径算法\n单元', type: '单元', x: 830, y: 110 },
  { id: 'U-308-04', label: '需求与迭代评审\n单元', type: '单元', x: 830, y: 240 },
  { id: 'T-308-04A', label: '迭代评审演练\n教学活动', type: '教学活动', x: 1070, y: 170 },
  { id: 'A-308-04A', label: '需求追踪矩阵\n考核任务', type: '考核', x: 1070, y: 310 },
]

export const mappings: Mapping[] = [
  { id: 'M-01', source: 'OBJ-01', target: 'GR-01', relation: '支撑', weight: 0.9 },
  { id: 'M-02', source: 'OBJ-02', target: 'GR-03', relation: '支撑', weight: 1 },
  { id: 'M-03', source: 'GR-01', target: 'C-101', relation: '支撑', weight: 0.9 },
  { id: 'M-04', source: 'GR-03', target: 'C-205', relation: '支撑', weight: 0.8 },
  { id: 'M-05', source: 'GR-03', target: 'C-308', relation: '支撑', weight: 1 },
  { id: 'M-06', source: 'GR-06', target: 'C-308', relation: '支撑', weight: 0.7 },
  { id: 'M-07', source: 'C-205', target: 'U-205-02', relation: '前置', weight: 0.85 },
  { id: 'M-08', source: 'C-308', target: 'U-308-04', relation: '支撑', weight: 0.9 },
  { id: 'M-09', source: 'U-308-04', target: 'T-308-04A', relation: '教学', weight: 1 },
  { id: 'M-10', source: 'T-308-04A', target: 'A-308-04A', relation: '考核', weight: 0.8 },
  { id: 'M-11', source: 'GR-06', target: 'C-308', relation: '支撑', weight: 0.7 },
]

export const reviewItems: ReviewItem[] = [
  { id: 'REV-201', courseId: 'C-308', requirementId: 'GR-03', evidence: '需求追踪矩阵、迭代评审记录、测试覆盖报告与教师评价量表。', submitter: '软件工程课程组', status: '待审阅', comment: '', baseRevision: 'R12' },
  { id: 'REV-202', courseId: 'C-308', requirementId: 'GR-06', evidence: '增加数据合规案例分析，但尚未提供评分记录。', submitter: '软件工程课程组', status: '待审阅', comment: '', baseRevision: 'R12' },
  { id: 'REV-203', courseId: 'C-205', requirementId: 'GR-01', evidence: '图算法实践已覆盖复杂工程问题建模，作业与测验记录完整。', submitter: '数据结构课程组', status: '已附议', comment: '覆盖证据充分，建议保留。', baseRevision: 'R12' },
]

/**
 * 离线草稿：数据结构课程组离线整理，等待网络恢复后并入院系版本。
 * 其中 GR-06 → C-308 与软件工程课程组已确认的覆盖冲突，
 * C-999 为离线期间录入的未注册课程代码，首次合并会校验失败，可清理后重试。
 */
export const offlineDraft: OfflineDraft = {
  id: 'DRAFT-DS-02',
  group: '数据结构课程组',
  baseRevision: 'R12',
  updatedAt: '2026-10-05 21:14',
  status: '待合并',
  attempts: 0,
  lastError: '',
  changes: [
    { source: 'GR-01', target: 'C-205', relation: '支撑', weight: 0.75, note: '图算法实践覆盖工程知识，作业与测验记录完整。' },
    { source: 'GR-06', target: 'C-308', relation: '支撑', weight: 0.9, note: '补充数据合规案例评分记录后上调权重。' },
    { source: 'GR-03', target: 'C-999', relation: '支撑', weight: 0.6, note: '离线期间录入的旧课程代码，待清理。' },
  ],
}

export const divergences: Divergence[] = []

export const mergeLog: MergeLogEntry[] = [
  { at: '2026-09-30 10:02', draftId: 'DRAFT-SE-01', ok: true, message: '软件工程课程组草稿并入 2 条映射，未产生分歧。' },
]

export const lockedVersions: LockedVersion[] = [
  {
    revision: 'R11',
    lockedAt: '2026-09-12 16:40',
    mappings: [
      { id: 'M-01', source: 'OBJ-01', target: 'GR-01', relation: '支撑', weight: 0.9 },
      { id: 'M-03', source: 'GR-01', target: 'C-101', relation: '支撑', weight: 0.9 },
      { id: 'M-05', source: 'GR-03', target: 'C-308', relation: '支撑', weight: 0.85 },
      { id: 'M-10', source: 'T-308-04A', target: 'A-308-04A', relation: '考核', weight: 0.8 },
    ],
    reviewItems: [
      { id: 'REV-180', courseId: 'C-101', requirementId: 'GR-01', evidence: '程序设计作业、上机测验与期末项目评分记录齐全。', submitter: '程序设计课程组', status: '已附议', comment: '证据链完整，纳入 R11 基线。', baseRevision: 'R11' },
      { id: 'REV-181', courseId: 'C-308', requirementId: 'GR-06', evidence: '工程伦理案例讨论记录，缺少评分量表。', submitter: '软件工程课程组', status: '已退回', comment: '请补充评分量表后重新提交。', baseRevision: 'R11' },
    ],
  },
]

export const seedState = {
  nodes,
  mappings,
  reviewItems,
  divergences,
  offlineDraft,
  mergeLog,
  lockedVersions,
  revision: 'R12',
  locked: false,
  online: true,
  actor: { name: '顾明', role: '课程负责人' } as Actor,
}
