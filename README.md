# 高校课程标准映射与课程改革审阅平台

面向教研人员、课程负责人和院系审阅人的课程图谱平台，支持培养目标、毕业要求、课程单元、教学活动、考核任务映射，以及有向图检查、覆盖矩阵、拖拽连边、自动保存、批量审核和课程地图导出。

## 技术栈

SvelteKit + Skeleton UI + Svelte stores + SvelteKit Form Actions + TanStack Query + Zod + Vite + TypeScript

## 本地运行

```bash
npm install
npm run dev
```

访问 `http://localhost:62049`，生产构建使用 `npm run build`。

## 核心工作流

- 在培养目标、毕业要求、课程、单元和考核之间建立有向映射。
- 自动检查前置关系、覆盖缺口、重复映射和不完整考核证据。
- 课程负责人离线整理课程图谱，网络恢复后把离线草稿并入院系版本；合并失败可重试，原草稿与待处理项保留，且不会重复生成审阅记录。
- 两个课程组修改同一对映射时，后到的修改先登记为待审阅分歧，不盖掉已确认的毕业要求覆盖；院系审阅人逐条确认保留哪一版。
- 映射一变，覆盖矩阵与缺口提示立即重算，基于旧版本的修订不能再附议；课程负责人越权附议会被直接拒绝。
- 锁定版本归档快照，已锁定版本的考核证据照旧可查；比较版本覆盖变化，恢复草稿并导出专业课程地图。

## 领域规则验证

```bash
./node_modules/.bin/esbuild scripts/verify-domain.ts --bundle --platform=node --format=esm --outfile=/tmp/verify-domain.mjs && node /tmp/verify-domain.mjs
```

覆盖离线合并、失败重试、冲突分歧、越权拒绝、旧修订禁附议、锁定归档等 33 项规则。
