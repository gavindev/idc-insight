// ============================================================
// CMDB 种子数据：建表 + 首次填充
//   - 42U 机柜、1U/2U/4U 服务器（含带外管理 IP）
//   - 网络设备：Leaf(ToR) / Spine(内网) / Edge(外网出口) / MGMT(带外管理)
//   - 链路分层：内网 lan / 外网 wan / 带外管理 oob
// 数据一旦写入 cmdb.db，再次启动不会重复插入。
// ============================================================

import {
  ROWS,
  RACKS_PER_ROW,
  RACK_U,
  SPINES,
  ROW_MODULES,
  SERVICES,
} from '../src/constants.js';

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, '0');

function rollStatus(rand, faultP, warnP) {
  const v = rand();
  if (v < faultP) return 'fault';
  if (v < faultP + warnP) return 'warning';
  return 'normal';
}

export function seedCmdb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rows (
      id     INTEGER PRIMARY KEY,
      name   TEXT NOT NULL,
      letter TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS racks (
      id        INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      row_id    INTEGER NOT NULL REFERENCES rows(id),
      position  INTEGER NOT NULL,
      u_height  INTEGER NOT NULL DEFAULT 42,
      model     TEXT,
      status    TEXT NOT NULL DEFAULT 'normal'
    );

    CREATE TABLE IF NOT EXISTS devices (
      id        INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      type      TEXT NOT NULL,          -- 'leaf' | 'spine' | 'edge' | 'mgmt'
      rack_id   INTEGER REFERENCES racks(id),
      ip        TEXT,
      mgmt_ip   TEXT,
      model     TEXT,
      business  TEXT,
      status    TEXT NOT NULL DEFAULT 'normal'
    );

    CREATE TABLE IF NOT EXISTS servers (
      id        INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      rack_id   INTEGER NOT NULL REFERENCES racks(id),
      u_start   INTEGER NOT NULL,
      u_height  INTEGER NOT NULL,       -- 1 / 2 / 4
      ip        TEXT,
      mgmt_ip   TEXT,
      model     TEXT,
      business  TEXT,
      status    TEXT NOT NULL DEFAULT 'normal'
    );

    CREATE TABLE IF NOT EXISTS links (
      id     INTEGER PRIMARY KEY,
      plane  TEXT NOT NULL,             -- 'lan' | 'wan' | 'oob'
      a_id   INTEGER NOT NULL REFERENCES devices(id),
      b_id   INTEGER NOT NULL REFERENCES devices(id),
      status TEXT NOT NULL DEFAULT 'normal'
    );
  `);

  const { c } = db.prepare('SELECT COUNT(*) AS c FROM racks').get();
  if (c > 0) return; // 已有数据，跳过填充

  const rand = mulberry32(20240101);

  const insertRow = db.prepare('INSERT INTO rows (name, letter) VALUES (?, ?)');
  const insertRack = db.prepare(
    'INSERT INTO racks (name, row_id, position, u_height, model, status) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertDevice = db.prepare(
    'INSERT INTO devices (name, type, rack_id, ip, mgmt_ip, model, business, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertServer = db.prepare(
    'INSERT INTO servers (name, rack_id, u_start, u_height, ip, mgmt_ip, model, business, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertLink = db.prepare('INSERT INTO links (plane, a_id, b_id) VALUES (?, ?, ?)');

  db.exec('BEGIN');

  // 排
  const rowIds = [];
  for (let r = 0; r < ROWS; r++) {
    const letter = String.fromCharCode(65 + r);
    rowIds.push(Number(insertRow.run(`第${r + 1}排`, letter).lastInsertRowid));
  }

  // 网络设备：Spine(内网骨干) / Edge(外网出口) / MGMT(带外管理)
  const spineIds = [];
  for (let i = 0; i < SPINES; i++) {
    spineIds.push(
      Number(
        insertDevice
          .run(
            `Spine-${pad(i + 1)}`,
            'spine',
            null,
            `10.0.0.${i + 1}`,
            `10.99.250.${i + 1}`,
            'CE12808',
            '全网骨干 · Spine 核心交换（内网）',
            'normal'
          )
          .lastInsertRowid
      )
    );
  }

  const edgeIds = [];
  for (let i = 0; i < 2; i++) {
    edgeIds.push(
      Number(
        insertDevice
          .run(
            `Edge-${pad(i + 1)}`,
            'edge',
            null,
            `198.51.100.${i + 1}`,
            `10.99.251.${i + 1}`,
            'NE40E-X8',
            '外网出口 · 互联网接入',
            'normal'
          )
          .lastInsertRowid
      )
    );
  }

  const mgmtIds = [];
  for (let i = 0; i < 2; i++) {
    mgmtIds.push(
      Number(
        insertDevice
          .run(
            `MGMT-${pad(i + 1)}`,
            'mgmt',
            null,
            `10.99.254.${i + 1}`,
            `10.99.254.${i + 1}`,
            'S5735-L24T4X',
            '带外管理网 · 全网设备管理汇聚',
            'normal'
          )
          .lastInsertRowid
      )
    );
  }

  // 机柜 + Leaf + 服务器（1U/2U/4U 混合，42U 机柜）
  const leafIds = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < RACKS_PER_ROW; c++) {
      const rackName = `${String.fromCharCode(65 + r)}${pad(c + 1)}`;
      const rackNum = r * RACKS_PER_ROW + c + 1; // 1..40
      const rackId = Number(
        insertRack.run(`${rackName} 机柜`, rowIds[r], c, RACK_U, 'NetShelter SX 42U', 'normal')
          .lastInsertRowid
      );

      const leafId = Number(
        insertDevice
          .run(
            `Leaf-${rackName}`,
            'leaf',
            rackId,
            `10.${10 + r}.${c + 1}.1`,
            `10.99.${rackNum}.1`,
            'CE6857-48S6CQ',
            `${ROW_MODULES[r]} · 接入交换 (ToR)`,
            'normal'
          )
          .lastInsertRowid
      );
      leafIds.push(leafId);

      let u = 1;
      let ipSeq = 11;
      while (u <= RACK_U) {
        const rem = RACK_U - u + 1;
        const rn = rand();
        let h = rn < 0.12 ? 4 : rn < 0.42 ? 2 : 1;
        if (h > rem) h = rem >= 2 ? 2 : 1;

        const model =
          h === 4 ? 'RH8100 V3 (4U)' : h === 2 ? 'RH5885 V3 (2U)' : 'RH2288H V5 (1U)';
        insertServer.run(
          `${rackName}-U${pad(u)}`,
          rackId,
          u,
          h,
          `10.${10 + r}.${c + 1}.${ipSeq}`,
          `10.99.${rackNum}.${10 + u}`,
          model,
          `${ROW_MODULES[r]} · ${SERVICES[(u - 1) % SERVICES.length]}`,
          rollStatus(rand, 0.05, 0.12)
        );

        u += h;
        ipSeq += 1;
        // 上下相邻服务器之间留 1U（偶尔 2U）通风间隙
        u += rand() < 0.2 ? 2 : 1;
      }
    }
  }

  // 链路分层
  // 内网 lan：Leaf <-> Spine 全互联
  for (const leafId of leafIds) {
    for (const spineId of spineIds) insertLink.run('lan', leafId, spineId);
  }
  // 外网 wan：Spine <-> Edge（出口）
  for (const spineId of spineIds) {
    for (const edgeId of edgeIds) insertLink.run('wan', spineId, edgeId);
  }
  // 带外管理 oob：MGMT <-> 所有设备（Leaf/Spine/Edge）
  for (const mgmtId of mgmtIds) {
    for (const leafId of leafIds) insertLink.run('oob', mgmtId, leafId);
    for (const spineId of spineIds) insertLink.run('oob', mgmtId, spineId);
    for (const edgeId of edgeIds) insertLink.run('oob', mgmtId, edgeId);
  }

  // 指定若干网络设备为告警/故障，便于演示
  db.prepare('UPDATE devices SET status = ? WHERE name = ?').run('fault', 'Leaf-A05');
  db.prepare('UPDATE devices SET status = ? WHERE name = ?').run('warning', 'Leaf-B02');
  db.prepare('UPDATE devices SET status = ? WHERE name = ?').run('warning', 'Leaf-C07');
  db.prepare('UPDATE devices SET status = ? WHERE name = ?').run('fault', 'Spine-02');
  db.prepare('UPDATE devices SET status = ? WHERE name = ?').run('warning', 'Spine-04');
  db.prepare('UPDATE devices SET status = ? WHERE name = ?').run('warning', 'Edge-02');

  db.exec('COMMIT');
}
