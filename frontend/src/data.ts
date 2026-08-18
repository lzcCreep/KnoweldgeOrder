export type SyncStatus = 'local' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'failed'

export type Note = {
  id: number | string
  title: string
  summary: string
  content: string
  tag: string
  collection: string
  updated: string
  readTime: number
  pinned?: boolean
  favorite?: boolean
  revision?: number
  createdAt?: string
  updatedAt?: string
  deletedAt?: string | null
  spaceId?: string
  syncStatus?: SyncStatus
  syncError?: string | null
  archived?: boolean
  archiveFolderId?: string | null
}

export type Collection = {
  name: string
  color: string
  count?: number
}

export const seedNotes: Note[] = [
  {
    id: 1,
    title: '从信息收藏到知识复利',
    summary: '真正有价值的知识库不是仓库，而是一套能持续产生连接、提醒与行动的工作系统。',
    content: '收藏解决的是“以后可能有用”，知识管理解决的是“现在如何使用”。每条输入都应该经过提炼、连接和回顾。建立每周回顾，把零散记录变成项目决策、方法论或下一步行动。',
    tag: '思考',
    collection: '知识管理',
    updated: '今天 09:42',
    readTime: 4,
    pinned: true,
    favorite: true,
  },
  {
    id: 2,
    title: 'RAG 产品落地检查清单',
    summary: '从数据清洗、分块策略到召回评估，一份面向真实产品的实施检查清单。',
    content: 'RAG 上线前应依次确认：数据权限、内容清洗、语义分块、混合检索、重排、引用溯源和离线评估。回答必须附带来源，并允许用户快速回到原文。',
    tag: 'AI',
    collection: '产品与技术',
    updated: '昨天 21:16',
    readTime: 7,
    pinned: true,
  },
  {
    id: 3,
    title: '第二季度个人目标回顾',
    summary: '减少同时进行的项目数量，把精力集中到健康、深度工作和长期作品。',
    content: '本季度最大的收获是认识到精力比时间更稀缺。下季度只保留三个重点：规律运动、完成知识库 MVP、每周一次长文写作。',
    tag: '复盘',
    collection: '生活记录',
    updated: '8 月 10 日',
    readTime: 5,
    favorite: true,
  },
  {
    id: 4,
    title: '高质量访谈的提问方式',
    summary: '少问观点，多还原最近一次真实行为；让事实先于解释出现。',
    content: '访谈时避免询问“你会不会使用”，改为“上一次遇到这个问题是什么时候”。追问当时的环境、替代方案、真实成本和最终决定。',
    tag: '产品',
    collection: '产品与技术',
    updated: '8 月 8 日',
    readTime: 3,
  },
  {
    id: 5,
    title: '体检指标与年度健康计划',
    summary: '整理年度体检中的关键指标，并转换成可以按周执行的运动与睡眠计划。',
    content: '年度重点是保持每周三次中等强度运动，固定睡眠窗口，并在三个月后复查相关指标。用周完成率而非单日波动评估执行情况。',
    tag: '健康',
    collection: '生活记录',
    updated: '8 月 3 日',
    readTime: 6,
  },
  {
    id: 6,
    title: '《打造第二大脑》阅读摘记',
    summary: '用 PARA 组织正在行动的信息，以渐进式总结降低未来重新理解的成本。',
    content: 'PARA 将信息按可行动性分为项目、领域、资源和归档。渐进式总结强调在每次使用时多提炼一层，不要求首次记录就做到完美。',
    tag: '阅读',
    collection: '阅读与灵感',
    updated: '7 月 29 日',
    readTime: 8,
    favorite: true,
  },
]

export const collections: Collection[] = [
  { name: '知识管理', count: 18, color: '#407a62' },
  { name: '产品与技术', count: 26, color: '#4f6fa8' },
  { name: '阅读与灵感', count: 14, color: '#b06c42' },
  { name: '生活记录', count: 9, color: '#8b6a9e' },
]
