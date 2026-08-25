export type ProjectStatus = string;

export interface Project {
  id: string;
  name: string;
  category?: string;
  keywords: string[];
  statusId?: string;
  status: ProjectStatus;
  stage: string;
  priority?: string;
  plannedEndDate: string;
  description?: string;
  progress: string;
  progressPercent?: number;
  blockers: string[];
  owner: string;
  lastUpdated: string;
  sources: string[];
}

export const statusLabel: Record<string, string> = {
  on_track: "正常",
  at_risk: "有风险",
  delayed: "已延期",
  unknown: "信息不足",
};

export const projects: Project[] = [
  {
    id: "project-001",
    name: "独立站商品详情页重构",
    keywords: ["独立站", "商品详情页", "详情页重构"],
    status: "at_risk",
    stage: "支付与物流接口联调",
    plannedEndDate: "2026-08-22",
    progress: "商品详情页、购物车和订单页已完成；支付接口联调约完成 80%。",
    blockers: ["客户尚未提供正式的物流接口字段说明。"],
    owner: "张晨",
    lastUpdated: "2026-08-18",
    sources: ["第 32 周项目周报", "8 月 18 日项目例会纪要"],
  },
  {
    id: "project-002",
    name: "天猫旗舰店双 11 预热活动页",
    keywords: ["天猫", "双11", "双 11", "预热活动页"],
    status: "on_track",
    stage: "页面开发与商品数据校验",
    plannedEndDate: "2026-08-28",
    progress: "活动首页和商品会场页面已完成；商品价格、库存和优惠券规则正在核对。",
    blockers: ["部分商品优惠规则仍待运营确认。"],
    owner: "李敏",
    lastUpdated: "2026-08-19",
    sources: ["活动排期表", "运营需求文档", "商品配置清单"],
  },
  {
    id: "project-003",
    name: "小程序会员积分系统升级",
    keywords: ["小程序", "会员积分", "积分系统"],
    status: "delayed",
    stage: "用户验收测试（UAT）",
    plannedEndDate: "2026-08-15",
    progress: "开发已完成，但测试发现积分过期规则计算异常，暂未发布。",
    blockers: ["第三方短信服务测试环境不稳定。", "积分过期规则计算异常。"],
    owner: "王磊",
    lastUpdated: "2026-08-16",
    sources: ["UAT 缺陷清单", "测试日报", "项目周报"],
  },
];
