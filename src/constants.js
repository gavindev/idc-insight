// ============================================================
// 全局常量：状态、颜色、尺寸、业务字典
// ============================================================

export const ROWS = 5; // 机房排数
export const RACKS_PER_ROW = 8; // 每排机柜数
export const RACK_U = 42; // 每个机柜的 U 位（1U 服务器位）
export const SPINES = 4; // Spine 骨干交换机数量

export const STATUS = {
  NORMAL: 'normal',
  WARNING: 'warning',
  FAULT: 'fault',
};

export const STATUS_RANK = { normal: 0, warning: 1, fault: 2 };

export const STATUS_LABEL = {
  normal: '正常',
  warning: '告警',
  fault: '故障',
};

// 3D 颜色（hex number）
export const COLOR = {
  normal: 0x3b82f6,
  warning: 0xf59e0b,
  fault: 0xef4444,
};

// CSS 颜色（string）
export const CSS = {
  normal: '#3b82f6',
  warning: '#f59e0b',
  fault: '#ef4444',
};

// ---------- 尺寸（单位：米） ----------
export const RACK_W = 0.62; // 机柜宽
export const RACK_D = 1.0; // 机柜深
export const RACK_H = 2.06; // 机柜高（42U + 底座/顶盖）
export const U_H = 0.045; // 每 1U 的高度
export const RACK_GAP_X = 0.9; // 同排机柜中心间距
export const ROW_GAP_Z = 3.8; // 排与排之间的间距

export const SERVER_W = 0.5; // 服务器宽
export const SERVER_D = 0.85; // 服务器深
export const U_GAP = 0.008; // 服务器层间通风缝隙（米）

// 网络分层
export const PLANES = {
  LAN: 'lan',
  WAN: 'wan',
  OOB: 'oob',
};

export const PLANE_INFO = {
  lan: { name: '内网', label: '内网 · 生产网', color: 0x38bdf8, css: '#38bdf8' },
  wan: { name: '外网', label: '外网 · 出口网', color: 0x34d399, css: '#34d399' },
  oob: { name: '带外管理网', label: '带外管理 · OOB', color: 0xa78bfa, css: '#a78bfa' },
};

// 网络设备类型
export const DEVICE_TYPE_LABEL = {
  leaf: '接入交换机（Leaf / ToR）',
  spine: '骨干交换机（Spine）',
  edge: '外网出口（Edge）',
  mgmt: '带外管理交换机（MGMT）',
};

// 链路高亮（选中/悬浮）
export const LINK_HIGHLIGHT = 0x60c8ff; // 亮青

// ---------- 业务字典（让信息更贴近真实机房） ----------
export const ROW_MODULES = ['支付平台', '电商交易', '风控系统', '数据中台', '视频流'];

export const SERVICES = [
  'Web接入',
  '应用服务',
  '缓存服务',
  '消息队列',
  '数据库',
  '对象存储',
  '计算节点',
  '日志采集',
];
