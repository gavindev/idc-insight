// ============================================================
// 数据适配层：从 CMDB（SQLite）接口读取机房/机柜/服务器/网络设备/链路，
// 归一化为 3D 场景可用的结构，并派生状态与统计、建立 IP 索引。
// ============================================================

import {
  STATUS,
  STATUS_RANK,
  RACK_H,
  RACK_GAP_X,
  ROW_GAP_Z,
} from './constants.js';

function worst(a, b) {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

// 各类网络设备的链路挂接点高度（顶部）
const DEVICE_ATTACH_Y = {
  leaf: RACK_H + 0.12,
  spine: 0.85,
  edge: 0.7,
  mgmt: 0.45,
};

export async function loadData() {
  const res = await fetch('/api/cmdb');
  if (!res.ok) throw new Error(`CMDB 接口异常（HTTP ${res.status}）`);
  const cmdb = await res.json();
  return normalizeCmdb(cmdb);
}

export function normalizeCmdb(cmdb) {
  const rowIdxById = new Map(cmdb.rows.map((r) => [r.id, r.id - 1]));
  const rowNameById = new Map(cmdb.rows.map((r) => [r.id, r.name]));
  const rowLetterById = new Map(cmdb.rows.map((r) => [r.id, r.letter]));
  const rackNameById = new Map(cmdb.racks.map((r) => [r.id, r.name]));

  const rows = cmdb.rows.map((r) => ({ index: r.id - 1, letter: r.letter, name: r.name }));

  const racks = cmdb.racks.map((r) => ({
    id: `rack-${r.id}`,
    dbId: r.id,
    kind: 'rack',
    name: r.name,
    model: r.model,
    rowIdx: rowIdxById.get(r.rowId),
    rowLetter: rowLetterById.get(r.rowId),
    rowName: rowNameById.get(r.rowId),
    indexInRow: r.position,
    uHeight: r.uHeight,
    status: STATUS.NORMAL,
    serverIds: [],
    leafId: null,
    x: 0,
    z: 0,
  }));

  const servers = cmdb.servers.map((s) => ({
    id: `srv-${s.id}`,
    dbId: s.id,
    kind: 'server',
    name: s.name,
    ip: s.ip,
    mgmt: s.mgmtIp,
    model: s.model,
    business: s.business,
    status: s.status,
    rackId: `rack-${s.rackId}`,
    rackName: rackNameById.get(s.rackId),
    uStart: s.uStart,
    uHeight: s.uHeight,
    x: 0,
    z: 0,
  }));

  // 网络设备按类型分组，统一 id 前缀
  const byType = { leaf: [], spine: [], edge: [], mgmt: [] };
  const deviceFrontId = new Map(); // DB id -> 前端 id
  for (const d of cmdb.devices) {
    const id = `${d.type}-${d.id}`;
    const dev = {
      id,
      dbId: d.id,
      kind: d.type,
      name: d.name,
      ip: d.ip,
      mgmt: d.mgmtIp,
      model: d.model,
      business: d.business,
      status: d.status,
      rackId: d.rackId ? `rack-${d.rackId}` : null,
      rackName: d.rackId ? rackNameById.get(d.rackId) : null,
      attachY: DEVICE_ATTACH_Y[d.type] || 0.8,
      x: 0,
      z: 0,
    };
    deviceFrontId.set(d.id, id);
    byType[d.type].push(dev);
  }

  const links = cmdb.links.map((l) => ({
    id: `link-${l.id}`,
    dbId: l.id,
    kind: 'link',
    plane: l.plane,
    aId: deviceFrontId.get(l.aId),
    bId: deviceFrontId.get(l.bId),
    status: STATUS.NORMAL,
  }));

  const leaves = byType.leaf;
  const spines = byType.spine;
  const edges = byType.edge;
  const mgmts = byType.mgmt;

  // 平面布局
  layout(rows, racks, leaves, spines, edges, mgmts);

  // 机柜关联
  const rackById = new Map(racks.map((r) => [r.id, r]));
  for (const s of servers) rackById.get(s.rackId).serverIds.push(s.id);
  for (const l of leaves) if (l.rackId) rackById.get(l.rackId).leafId = l.id;

  const data = {
    rows,
    racks,
    servers,
    leaves,
    spines,
    edges,
    mgmts,
    links,
    meta: {
      roomName: 'B1-01 核心机房',
      rows: rows.length,
      spines: spines.length,
    },
    stats: null,
  };

  data.byId = new Map();
  for (const list of [data.servers, data.leaves, data.spines, data.edges, data.mgmts, data.racks, data.links]) {
    for (const o of list) data.byId.set(o.id, o);
  }

  // IP 索引（业务 IP + 带外管理 IP）
  data.byIp = new Map();
  for (const list of [data.servers, data.leaves, data.spines, data.edges, data.mgmts]) {
    for (const o of list) {
      if (o.ip) data.byIp.set(o.ip.trim(), o.id);
      if (o.mgmt) data.byIp.set(o.mgmt.trim(), o.id);
    }
  }

  recompute(data);
  return data;
}

function layout(rows, racks, leaves, spines, edges, mgmts) {
  const numRows = rows.length;

  // 机柜排
  const byRow = new Map();
  for (const rack of racks) {
    if (!byRow.has(rack.rowIdx)) byRow.set(rack.rowIdx, []);
    byRow.get(rack.rowIdx).push(rack);
  }
  for (const [rowIdx, list] of byRow) {
    list.sort((a, b) => a.indexInRow - b.indexInRow);
    const z = (rowIdx - (numRows - 1) / 2) * ROW_GAP_Z;
    const count = list.length;
    for (const rack of list) {
      rack.x = (rack.indexInRow - (count - 1) / 2) * RACK_GAP_X;
      rack.z = z;
    }
  }

  // Leaf 跟随机柜（ToR）
  const rackById = new Map(racks.map((r) => [r.id, r]));
  for (const leaf of leaves) {
    const r = rackById.get(leaf.rackId);
    if (r) {
      leaf.x = r.x;
      leaf.z = r.z;
    }
  }

  // 网络区：Spine / Edge / MGMT 三个子区
  const spineZ = ((numRows - 1) / 2 + 1) * ROW_GAP_Z + 1.0;
  spread(spines, spineZ, 2.2);
  spread(edges, spineZ + 3.2, 2.6);
  spread(mgmts, spineZ - 3.2, 2.6);
}

function spread(list, z, gap) {
  const count = list.length;
  list.forEach((d, i) => {
    d.x = (i - (count - 1) / 2) * gap;
    d.z = z;
  });
}

// 派生：机柜状态 = 柜内服务器与 Leaf 的最严重状态；链路状态 = 两端设备的最严重状态
function recompute(data) {
  const byId = new Map();
  for (const s of data.servers) byId.set(s.id, s);
  for (const list of [data.leaves, data.spines, data.edges, data.mgmts]) {
    for (const d of list) byId.set(d.id, d);
  }

  for (const rack of data.racks) {
    let st = STATUS.NORMAL;
    for (const sid of rack.serverIds) st = worst(st, byId.get(sid).status);
    if (rack.leafId) st = worst(st, byId.get(rack.leafId).status);
    rack.status = st;
  }

  for (const link of data.links) {
    link.status = worst(byId.get(link.aId).status, byId.get(link.bId).status);
  }

  const count = (list, fn) => list.filter(fn).length;
  data.stats = {
    servers: data.servers.length,
    serverFault: count(data.servers, (s) => s.status === STATUS.FAULT),
    serverWarning: count(data.servers, (s) => s.status === STATUS.WARNING),
    racks: data.racks.length,
    rackFault: count(data.racks, (r) => r.status === STATUS.FAULT),
    rackWarning: count(data.racks, (r) => r.status === STATUS.WARNING),
    leaves: data.leaves.length,
    leafFault: count(data.leaves, (l) => l.status === STATUS.FAULT),
    leafWarning: count(data.leaves, (l) => l.status === STATUS.WARNING),
    spines: data.spines.length,
    spineFault: count(data.spines, (s) => s.status === STATUS.FAULT),
    spineWarning: count(data.spines, (s) => s.status === STATUS.WARNING),
    edges: data.edges.length,
    edgeFault: count(data.edges, (e) => e.status === STATUS.FAULT),
    edgeWarning: count(data.edges, (e) => e.status === STATUS.WARNING),
    mgmts: data.mgmts.length,
    mgmtFault: count(data.mgmts, (m) => m.status === STATUS.FAULT),
    mgmtWarning: count(data.mgmts, (m) => m.status === STATUS.WARNING),
    links: data.links.length,
    linkFault: count(data.links, (l) => l.status === STATUS.FAULT),
    linkWarning: count(data.links, (l) => l.status === STATUS.WARNING),
  };
  return data.stats;
}

// 按 IP 查找设备/服务器
export function findByIp(data, ip) {
  const key = (ip || '').trim();
  if (!key) return null;
  if (data.byIp.has(key)) return data.byId.get(data.byIp.get(key));
  // 前缀匹配（如只输了网段）
  for (const [k, id] of data.byIp) {
    if (k.startsWith(key)) return data.byId.get(id);
  }
  return null;
}

export function randomizeFaults(data) {
  const rand = mulberry32(Math.floor(Math.random() * 1e9));
  for (const s of data.servers) s.status = rollStatus(rand, 0.06, 0.14);
  for (const list of [data.leaves, data.spines, data.edges, data.mgmts]) {
    for (const d of list) d.status = rollStatus(rand, 0.08, 0.12);
  }
  recompute(data);
  return data.stats;
}

export function resetAll(data) {
  for (const s of data.servers) s.status = STATUS.NORMAL;
  for (const list of [data.leaves, data.spines, data.edges, data.mgmts]) {
    for (const d of list) d.status = STATUS.NORMAL;
  }
  recompute(data);
  return data.stats;
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rollStatus(rand, faultP, warnP) {
  const v = rand();
  if (v < faultP) return STATUS.FAULT;
  if (v < faultP + warnP) return STATUS.WARNING;
  return STATUS.NORMAL;
}
