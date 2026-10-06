export function load({ url }: { url: URL }) {
  const titles: Record<string, string> = {
    '/': '课程标准映射总览',
    '/courses': '课程、单元与考核',
    '/matrix': '映射图谱与覆盖矩阵',
    '/merge': '离线草稿合并与分歧裁决',
    '/review': '课程改革审阅',
  }
  return { title: titles[url.pathname] ?? '课程改革审阅平台' }
}
