export const locale = "zh-CN";

// Fixed product and domain labels stay English in localized copy.
export const glossary = {
  coreConsole: "Core Console",
  home: "Home",
  users: "Users",
  finance: "Finance",
  settings: "Settings",
  overview: "Overview",
  transactions: "Transactions",
  accounts: "Accounts",
  categories: "Categories",
  ledger: "Ledger",
  account: "Account",
  category: "Category",
  transaction: "Transaction",
  balanceAdjustment: "Balance Adjustment",
  internalTransfer: "Internal Transfer",
} as const;

// The first locale is a typed catalog; no provider or locale state is needed.
export const messages = {
  app: {
    loading: "正在加载应用…",
    startupFailed: "应用无法启动，请刷新页面重试。",
  },
  common: {
    returnHome: "返回 Home",
  },
  finance: {
    viewMonthTransactions: "查看本月流水",
  },
  shell: {
    sidebarLabel: "Core Console 侧边栏",
    primaryNavigation: "主导航",
    expandSidebar: "展开侧边栏",
    collapseSidebar: "收起侧边栏",
    currentUser: "当前用户",
    loadingUser: "正在加载用户",
    pleaseWait: "请稍候",
    userUnavailable: "无法加载用户",
    retryLater: "请稍后重试",
  },
  home: {
    welcome: "欢迎使用 Core Console。",
  },
  notFound: {
    title: "页面不存在",
    description: "找不到此页面，请检查地址。",
  },
  routeError: {
    requestFailedTitle: (status: number) => `${status} 请求失败`,
    requestFailedDescription: "无法完成此操作，请稍后重试。",
    unexpectedTitle: "应用出错",
    unexpectedDescription: "应用发生意外错误，请刷新页面重试。",
    unknownTitle: "未知错误",
    unknownDescription: "应用发生未知错误，请刷新页面重试。",
  },
} as const;
