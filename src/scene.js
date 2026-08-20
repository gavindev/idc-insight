// ============================================================
// 3D 场景构建：地板、机柜（含服务器，层间留通风间隙）、交换机（含端口面板）、
// 分层网络链路（内网/外网/带外管理），以及按状态刷新颜色。
// ============================================================

import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import {
  STATUS,
  COLOR,
  PLANES,
  PLANE_INFO,
  RACK_W,
  RACK_D,
  RACK_H,
  U_H,
  U_GAP,
  SERVER_W,
  SERVER_D,
} from './constants.js';

const FACE_IDX = 4; // BoxGeometry 的 +z（前面）面索引

// 状态样式（服务器/交换机面板共用）
const STATUS_STYLE = {
  normal: { css: '#3b82f6', glow: '#a9ccff', emissive: 0.18 },
  warning: { css: '#f59e0b', glow: '#ffd58a', emissive: 0.34 },
  fault: { css: '#ef4444', glow: '#ff9c9c', emissive: 0.55 },
};

// 交换机前面板端口布局（“端口在不同位置”：Spine 上行/线卡分离）
const SWITCH_FACE = {
  leaf: { w: 256, h: 24, ports: [{ x: 4, y: 12, w: 248, h: 8, cols: 16, rows: 1 }] },
  spine: {
    w: 256,
    h: 64,
    ports: [
      { x: 4, y: 11, w: 248, h: 9, cols: 6, rows: 1 }, // 上行/矩阵端口
      { x: 4, y: 24, w: 248, h: 34, cols: 10, rows: 3 }, // 线卡端口
    ],
  },
  edge: { w: 256, h: 48, ports: [{ x: 4, y: 13, w: 248, h: 30, cols: 8, rows: 2 }] },
  mgmt: { w: 256, h: 32, ports: [{ x: 4, y: 12, w: 248, h: 16, cols: 6, rows: 2 }] },
};

function drawPortGroup(ctx, g) {
  const cols = g.cols;
  const rows = g.rows;
  const pw = g.w / cols;
  const ph = g.h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = g.x + c * pw;
      const py = g.y + r * ph;
      ctx.fillStyle = '#0a0e13';
      ctx.fillRect(px + 1, py + 1, pw - 2, ph - 2);
      ctx.fillStyle = '#31e07f'; // 端口 LED（运行中）
      ctx.fillRect(px + pw * 0.5 - 1, py + 1, 2, 2);
    }
  }
}

function makeSwitchTexture(kind, statusKey) {
  const cfg = SWITCH_FACE[kind];
  const style = STATUS_STYLE[statusKey];
  const canvas = document.createElement('canvas');
  canvas.width = cfg.w;
  canvas.height = cfg.h;
  const ctx = canvas.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, 0, cfg.h);
  g.addColorStop(0, '#161a22');
  g.addColorStop(0.5, '#0d1016');
  g.addColorStop(1, '#07090d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cfg.w, cfg.h);

  // 状态灯条
  ctx.fillStyle = style.css;
  ctx.fillRect(3, 2, cfg.w - 6, 4);
  ctx.fillStyle = style.glow;
  ctx.fillRect(3, 3, cfg.w - 6, 2);

  // 端口组
  for (const pg of cfg.ports) drawPortGroup(ctx, pg);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// 服务器前面板贴图
function makeServerTexture(statusKey) {
  const style = STATUS_STYLE[statusKey];
  const w = 256;
  const h = 32;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#171b23');
  g.addColorStop(0.5, '#0d1016');
  g.addColorStop(1, '#07090d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = style.css;
  ctx.fillRect(3, 2, w - 6, 5);
  ctx.fillStyle = style.glow;
  ctx.fillRect(3, 3, w - 6, 3);

  ctx.fillStyle = '#04060a';
  for (let y = 12; y < h - 2; y += 4) {
    ctx.fillRect(4, y, w - 8, 2);
  }

  ctx.fillStyle = '#31e07f';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(w - 14 - i * 9, h - 8, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeStatusMaterial(texture, statusKey) {
  return new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xffffff,
    emissive: COLOR[statusKey],
    emissiveIntensity: STATUS_STYLE[statusKey].emissive,
    roughness: 0.5,
    metalness: 0.4,
  });
}

export function buildScene(data) {
  const root = new THREE.Group();

  // ---------- 共享材质 ----------
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x232c3a, metalness: 0.5, roughness: 0.55 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x141a24, metalness: 0.65, roughness: 0.5 });

  // 服务器正面（按状态）
  const serverFaceMats = {
    normal: makeStatusMaterial(makeServerTexture('normal'), 'normal'),
    warning: makeStatusMaterial(makeServerTexture('warning'), 'warning'),
    fault: makeStatusMaterial(makeServerTexture('fault'), 'fault'),
  };

  // 交换机正面（按设备类型 × 状态）
  const switchFaceMats = {};
  for (const kind of ['leaf', 'spine', 'edge', 'mgmt']) {
    switchFaceMats[kind] = {
      normal: makeStatusMaterial(makeSwitchTexture(kind, 'normal'), 'normal'),
      warning: makeStatusMaterial(makeSwitchTexture(kind, 'warning'), 'warning'),
      fault: makeStatusMaterial(makeSwitchTexture(kind, 'fault'), 'fault'),
    };
  }

  // 材质数组辅助
  function faceArray(faceMat) {
    return [bodyMat, bodyMat, bodyMat, bodyMat, faceMat, bodyMat];
  }

  // 服务器几何体按 U 高度（1U/2U/4U）
  const serverGeos = new Map();
  function serverGeoFor(uHeight) {
    if (!serverGeos.has(uHeight)) {
      serverGeos.set(uHeight, new THREE.BoxGeometry(SERVER_W, uHeight * U_H - U_GAP, SERVER_D));
    }
    return serverGeos.get(uHeight);
  }

  const meshes = {
    servers: new Map(),
    leaves: new Map(),
    spines: new Map(),
    edges: new Map(),
    mgmts: new Map(),
    pedestals: [], // spine/edge/mgmt 底座（可拾取）
    racks: new Map(),
    frames: [], // 机柜框架（可拾取）
    links: new Map(),
    linksGroup: new THREE.Group(),
    planeGroups: {
      [PLANES.LAN]: new THREE.Group(),
      [PLANES.WAN]: new THREE.Group(),
      [PLANES.OOB]: new THREE.Group(),
    },
  };
  meshes.linksGroup.name = 'links';
  for (const g of Object.values(meshes.planeGroups)) meshes.linksGroup.add(g);
  root.add(meshes.linksGroup);

  // ---------- 地板 ----------
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 70),
    new THREE.MeshStandardMaterial({ color: 0x0d1117, roughness: 0.95, metalness: 0.1 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.005;
  root.add(floor);

  // ---------- 网络设备 ----------
  function buildChassis(device, size, kind) {
    const group = new THREE.Group();
    group.position.set(device.x, 0, device.z);

    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(size.w + 0.2, 0.22, size.d + 0.2), frameMat);
    pedestal.position.y = 0.11;
    pedestal.userData = device;
    group.add(pedestal);
    meshes.pedestals.push(pedestal);

    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(size.w, size.h, size.d),
      faceArray(switchFaceMats[kind][device.status])
    );
    chassis.position.y = 0.22 + size.h / 2;
    chassis.userData = device;
    group.add(chassis);

    root.add(group);
    return chassis;
  }

  for (const spine of data.spines) {
    meshes.spines.set(spine.id, buildChassis(spine, { w: 2.0, h: 0.8, d: 0.8 }, 'spine'));
  }
  for (const edge of data.edges) {
    meshes.edges.set(edge.id, buildChassis(edge, { w: 1.8, h: 0.6, d: 0.7 }, 'edge'));
  }
  for (const mgmt of data.mgmts) {
    meshes.mgmts.set(mgmt.id, buildChassis(mgmt, { w: 1.2, h: 0.3, d: 0.55 }, 'mgmt'));
  }

  // ---------- 机柜 + Leaf + 服务器 ----------
  for (const rack of data.racks) {
    const group = new THREE.Group();
    group.position.set(rack.x, 0, rack.z);

    const postGeo = new THREE.BoxGeometry(0.05, RACK_H, RACK_D);
    const leftPost = new THREE.Mesh(postGeo, frameMat);
    leftPost.position.set(-RACK_W / 2, RACK_H / 2, 0);
    const rightPost = new THREE.Mesh(postGeo, frameMat);
    rightPost.position.set(RACK_W / 2, RACK_H / 2, 0);
    const top = new THREE.Mesh(new THREE.BoxGeometry(RACK_W, 0.05, RACK_D), frameMat);
    top.position.set(0, RACK_H, 0);
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(RACK_W, 0.08, RACK_D), frameMat);
    bottom.position.set(0, 0.04, 0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(RACK_W, RACK_H, 0.03), frameMat);
    back.position.set(0, RACK_H / 2, -RACK_D / 2);
    for (const m of [leftPost, rightPost, top, bottom, back]) {
      m.userData = rack;
      group.add(m);
      meshes.frames.push(m);
    }

    // 服务器（1U/2U/4U），上下之间留 1U 及以上通风间隙
    const baseY = 0.08;
    const serverCenterZ = RACK_D / 2 + 0.005 - SERVER_D / 2;
    for (const sid of rack.serverIds) {
      const server = data.byId.get(sid);
      const mesh = new THREE.Mesh(serverGeoFor(server.uHeight), faceArray(serverFaceMats[server.status]));
      mesh.position.set(0, baseY + (server.uStart - 1 + server.uHeight / 2) * U_H, serverCenterZ);
      mesh.userData = server;
      group.add(mesh);
      meshes.servers.set(server.id, mesh);
    }

    // Leaf（ToR，机柜顶部，含端口面板）
    const leaf = data.byId.get(rack.leafId);
    const leafMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.09, 0.72),
      faceArray(switchFaceMats.leaf[leaf.status])
    );
    leafMesh.position.set(0, RACK_H / 2 + 0.045, 0.06);
    leafMesh.userData = leaf;
    group.add(leafMesh);
    meshes.leaves.set(leaf.id, leafMesh);

    meshes.racks.set(rack.id, group);
    root.add(group);
  }

  // ---------- 分层链路（Line2） ----------
  for (const link of data.links) {
    const a = data.byId.get(link.aId);
    const b = data.byId.get(link.bId);

    const p0 = new THREE.Vector3(a.x, a.attachY, a.z);
    const p1 = new THREE.Vector3(b.x, b.attachY, b.z);
    const mid = new THREE.Vector3(
      (p0.x + p1.x) / 2,
      Math.max(p0.y, p1.y) + 1.8,
      (p0.z + p1.z) / 2
    );

    const curve = new THREE.QuadraticBezierCurve3(p0, mid, p1);
    const pts = curve.getPoints(20);
    const positions = [];
    for (const p of pts) positions.push(p.x, p.y, p.z);

    const geo = new LineGeometry();
    geo.setPositions(positions);
    const mat = new LineMaterial({
      color: PLANE_INFO[link.plane].color,
      linewidth: 1,
      transparent: true,
      opacity: planeOpacity(link.plane),
      depthWrite: false,
    });
    const line = new Line2(geo, mat);
    line.userData = link;
    meshes.planeGroups[link.plane].add(line);
    meshes.links.set(link.id, line);
  }

  // ---------- 状态同步 ----------
  function sync() {
    for (const s of data.servers) {
      meshes.servers.get(s.id).material[FACE_IDX] = serverFaceMats[s.status];
    }
    for (const l of data.leaves) {
      meshes.leaves.get(l.id).material[FACE_IDX] = switchFaceMats.leaf[l.status];
    }
    for (const s of data.spines) {
      meshes.spines.get(s.id).material[FACE_IDX] = switchFaceMats.spine[s.status];
    }
    for (const e of data.edges) {
      meshes.edges.get(e.id).material[FACE_IDX] = switchFaceMats.edge[e.status];
    }
    for (const m of data.mgmts) {
      meshes.mgmts.get(m.id).material[FACE_IDX] = switchFaceMats.mgmt[m.status];
    }
    syncLinks();
  }

  function planeOpacity(plane) {
    return plane === PLANES.OOB ? 0.16 : plane === PLANES.WAN ? 0.26 : 0.2;
  }

  function linkBaseColorHex(link) {
    if (link.status === STATUS.FAULT) return COLOR.fault;
    if (link.status === STATUS.WARNING) return COLOR.warning;
    return PLANE_INFO[link.plane].color;
  }

  function linkBaseOpacity(link) {
    if (link.status === STATUS.FAULT) return 0.75;
    if (link.status === STATUS.WARNING) return 0.6;
    return planeOpacity(link.plane);
  }

  function syncLinks() {
    for (const link of data.links) resetLink(link.id);
  }

  function resetLink(linkId) {
    const line = meshes.links.get(linkId);
    if (!line) return;
    const mat = line.material;
    mat.linewidth = 1;
    mat.color.setHex(linkBaseColorHex(line.userData));
    mat.opacity = linkBaseOpacity(line.userData);
  }

  function dimLink(linkId) {
    const line = meshes.links.get(linkId);
    if (!line) return;
    const mat = line.material;
    mat.linewidth = 1;
    mat.color.setHex(linkBaseColorHex(line.userData));
    mat.opacity = 0.05;
  }

  function setLink(linkId, { width, colorHex, opacity } = {}) {
    const line = meshes.links.get(linkId);
    if (!line) return;
    const mat = line.material;
    if (width !== undefined) mat.linewidth = width;
    if (colorHex !== undefined) mat.color.setHex(colorHex);
    if (opacity !== undefined) mat.opacity = opacity;
  }

  function setLinkResolution(w, h) {
    for (const line of meshes.links.values()) line.material.resolution.set(w, h);
  }

  // 呼吸灯：所有“正面”材质按状态分组
  const faces = {
    normal: [
      serverFaceMats.normal,
      switchFaceMats.leaf.normal,
      switchFaceMats.spine.normal,
      switchFaceMats.edge.normal,
      switchFaceMats.mgmt.normal,
    ],
    warning: [
      serverFaceMats.warning,
      switchFaceMats.leaf.warning,
      switchFaceMats.spine.warning,
      switchFaceMats.edge.warning,
      switchFaceMats.mgmt.warning,
    ],
    fault: [
      serverFaceMats.fault,
      switchFaceMats.leaf.fault,
      switchFaceMats.spine.fault,
      switchFaceMats.edge.fault,
      switchFaceMats.mgmt.fault,
    ],
  };

  return {
    root,
    meshes,
    materials: { faces },
    sync,
    syncLinks,
    resetLink,
    dimLink,
    setLink,
    setLinkResolution,
  };
}
