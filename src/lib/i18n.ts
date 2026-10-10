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
    quickEntry: {
      title: "快速记账",
      kind: "记账类型",
      expense: "支出",
      income: "收入",
      effectiveDate: "本次 Transaction 日期：",
      amount: "金额",
      amountCurrency: (currency: string) =>
        `金额币种：${currency}，由所选 Account 决定。`,
      selectCurrencyAccount: "请选择 Account 以确定币种。",
      selectAccount: "请选择 Account",
      selectedAccount: "所选 Account",
      selectedCategory: "所选 Category",
      unavailable: (label: string) => `${label}（不可用）`,
      accountGuidance: "仅可选择启用的 Account，金额币种由所选 Account 决定。",
      uncategorized: "未分类",
      categoryGuidance: "Category 为选填；选择未分类即可完成金额分配。",
      note: "备注",
      optional: "选填",
      record: (kind: "expense" | "income") =>
        kind === "expense" ? "记录支出" : "记录收入",
      recording: (kind: "expense" | "income") =>
        kind === "expense" ? "正在记录支出…" : "正在记录收入…",
      recorded: (kind: "expense" | "income") =>
        kind === "expense" ? "已记录支出。" : "已记录收入。",
      startAnother: "另建一笔 Transaction",
      otherActions: "其他 Transaction 操作",
      transferGuidance:
        "Internal Transfer 需要两个不同的启用 Account，且币种相同。",
      manageTransferAccounts: "管理用于 Internal Transfer 的 Accounts",
      needsAccount: "快速记账需要启用的 Account。",
      manageAccounts: "新建或取消归档 Account",
      noActiveAccount:
        "没有可用的启用 Account。草稿已保留，请先新建或取消归档 Account 再记录。",
      loadingReferences: "正在加载快速记账所需数据…",
      referencesFailed: "无法加载快速记账所需数据，请重试。",
      refreshingReferences: "正在刷新快速记账所需数据…",
      referenceRefreshFailed: "无法刷新快速记账所需数据。草稿已保留。",
      retryReferences: "重试加载快速记账数据",
      accountIdentity: (
        name: string,
        status: "active" | "archived",
        nature: "asset" | "liability",
        currency: string,
        position: number,
        count: number,
      ) =>
        `${name}，${status === "active" ? "启用" : "已归档"}，${nature === "asset" ? "资产" : "负债"}，${currency}，第 ${position} 个，共 ${count} 个`,
      categoryIdentity: (name: string, id: string) =>
        `${name}，Category 标识 ${id}`,
      validation: {
        positiveAmount: "请输入大于零的普通十进制金额。",
        integerDigits: "金额的整数位数过多。",
        currencyUnavailable: "此 Account 的金额币种不可用。",
        fractionDigits: (currency: string, minorUnit: number) =>
          minorUnit === 0
            ? `${currency} 金额不能包含小数。`
            : `${currency} 金额最多支持 ${minorUnit} 位小数。`,
        activeAccount: "请选择启用的 Account。",
        activeCategory: "请选择启用的 Category 或未分类。",
        validDate: "请输入有效的 Transaction 日期。",
        trackingDate: "请选择不早于 Account 跟踪起始日期的 Transaction 日期。",
        noteLength: "备注不能超过 500 个字符。",
        fields: "请检查 Transaction 字段后重试。",
        failed: "无法记录此 Transaction，请重试。",
        unavailable: "Transactions 暂时不可用，请稍后重试。",
        accountArchived: (label?: string) =>
          `${label ? `所选 Account（${label}）` : "此 Account"}已归档。请选择其他启用的 Account；其他输入已保留。`,
        accountMissing: (label?: string) =>
          `${label ? `所选 Account（${label}）` : "此 Account"}已不可用。请选择其他启用的 Account；其他输入已保留。`,
        categoryArchived: (label?: string) =>
          `${label ? `所选 Category（${label}）` : "此 Category"}已归档。请选择其他启用的 Category 或未分类；其他输入已保留。`,
        categoryMissing: (label?: string) =>
          `${label ? `所选 Category（${label}）` : "此 Category"}已不可用。请选择其他启用的 Category 或未分类；其他输入已保留。`,
      },
      recovery: {
        heading: "Finance 提交记录",
        userUnavailable:
          "当前用户不可用或正在加载。Finance 创建与恢复需要启用的用户。",
        storageTitle: "浏览器恢复不可用",
        reload: "重新加载恢复记录",
        notAdmitted: "命令未被接收",
        created: "Transaction 已创建",
        rejected: "Transaction 创建被拒绝",
        unknown: "Transaction 结果未知",
        description: (
          kind: "expense" | "income",
          amount: string,
          currency: string,
          date: string,
        ) =>
          `${kind === "expense" ? "支出" : "收入"} ${amount} ${currency} · ${date}`,
        titleDescription: (title: string, description: string) =>
          `${title}: ${description}`,
        saved: "结果已保存。确认结果后可移除此浏览器恢复记录。",
        retained: "原始命令已保存在此浏览器中。查询结果不会创建 Transaction。",
        originalLedger: (name: string) => `原始 Ledger：${name}`,
        check: "查询结果",
        retry: "重试原始提交",
        open: "打开 Transactions",
        refresh: "刷新 Transaction 列表",
        acknowledge: "确认结果",
        rejectedGuidance:
          "Transaction 命令被拒绝。请检查草稿；修改内容后需要新建提交。",
        notAdmittedGuidance: "此命令未被接收。请修正草稿后新建提交。",
        unknownGuidance:
          "Transaction 结果未知。请查询结果或重试原始提交，不要再次提交草稿。",
        confirmed:
          "已确认 Transaction 创建成功。可在 Transactions 查看当前状态。",
        resourceUnavailable:
          "已确认 Transaction 创建成功。此 Transaction 当前不可用，不会重新创建。",
        refreshFailed:
          "已确认 Transaction 创建成功。无法刷新 Transaction 列表，请重试刷新，不要再次创建。",
        conflict:
          "提交标识与另一命令冲突，恢复已阻止。请勿重试或创建替代提交。",
        update: "请先更新 Core Console 再恢复此提交。原始命令与版本已保留。",
        access: "当前无访问权限。请返回原始启用用户以恢复此提交。",
        unfinished: "原始提交尚未完成，请主动重试原始提交以继续。",
        failed: "无法完成恢复。请再次查询结果，原始提交已保留。",
        preparationFailed:
          "浏览器准备失败，未发送任何请求。请重新加载恢复记录后重试。",
        storageUnavailable:
          "浏览器存储不可用。请启用 IndexedDB 后再在 Finance 中创建。",
        storageBlocked:
          "浏览器存储升级被阻止。请关闭其他 Core Console 标签页后重新加载，并保留已有提交记录。",
        storageOpenFailed:
          "无法打开浏览器存储。请重新加载页面，勿清除站点数据。",
        storageIncompatible:
          "浏览器恢复存储不兼容。请更新或重新加载 Core Console，勿清除站点数据。",
        storageWriteFailed:
          "浏览器存储写入失败。已提交命令仍可恢复，请重新加载页面，勿清除站点数据。",
        damaged:
          "保留的提交不兼容或已损坏，恢复已阻止。请更新或重新加载 Core Console，勿清除站点数据。",
        commandChanged: "保留的命令已改变，恢复已阻止。",
        evidenceMismatch: "提交证据不匹配，恢复已阻止。",
        conflictingEvidence: "结果证据冲突，恢复已阻止。",
        unresolvedAcknowledgement: "仅可确认已持久保存结果的提交。",
        ownerChanged:
          "当前用户或 API 已改变。请返回原始用户和 API 以恢复此提交。",
        userChanged: "当前用户已改变或不可用。请重新加载，以原始用户身份恢复。",
        alreadyAcknowledged: "此提交已确认，不会重试。",
        responseMismatch: "响应证据与此提交不匹配。请查询结果，勿再次创建。",
        outcomeMismatch: "结果证据与原始命令不匹配，恢复已阻止。",
        lookupMismatch: "查询证据与原始命令不匹配，恢复已阻止。",
        userRequired: "Finance 创建需要启用的用户及可用的浏览器存储。",
      },
    },
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
