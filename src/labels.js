// ============================================================
// CSS2D 文本标签：排标签、机柜标签、Spine 标签、网络区标签
// ============================================================

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RACK_H, ROW_GAP_Z } from './constants.js';

export function buildLabels(data) {
  const scene = new THREE.Scene();
  const rackLabels = []; // { label, rack } 用于按距离显隐

  function make(text, cls) {
    const el = document.createElement('div');
    el.className = 'dsh-label ' + cls;
    el.textContent = text;
    const o = new CSS2DObject(el);
    scene.add(o);
    return o;
  }

  // 排标签
  const rowCenterX = 0;
  for (const row of data.rows) {
    const z = (row.index - (data.rows.length - 1) / 2) * ROW_GAP_Z;
    const l = make(`第${row.index + 1}排 · ${row.letter}`, 'row-label');
    l.position.set(rowCenterX, RACK_H + 1.15, z);
  }

  // 机柜标签
  for (const rack of data.racks) {
    const l = make(rack.name.replace(' 机柜', ''), 'rack-label');
    l.position.set(rack.x, RACK_H + 0.2, rack.z);
    rackLabels.push({ label: l, rack });
  }

  // 网络设备标签
  for (const spine of data.spines) {
    const l = make(spine.name, 'spine-label');
    l.position.set(spine.x, 1.6, spine.z);
  }
  for (const edge of data.edges) {
    const l = make(edge.name, 'spine-label');
    l.position.set(edge.x, 1.35, edge.z);
  }
  for (const mgmt of data.mgmts) {
    const l = make(mgmt.name, 'spine-label');
    l.position.set(mgmt.x, 1.0, mgmt.z);
  }

  // 网络区标签
  const spineZ = ((data.rows.length - 1) / 2 + 1) * ROW_GAP_Z + 1.0;
  const spineZone = make('内网区 · Spine', 'zone-label');
  spineZone.position.set(0, RACK_H + 1.35, spineZ);

  const edgeZone = make('外网区 · Edge', 'zone-label');
  edgeZone.position.set(0, RACK_H + 1.35, spineZ + 3.2);

  const mgmtZone = make('带外管理区 · MGMT', 'zone-label');
  mgmtZone.position.set(0, RACK_H + 1.35, spineZ - 3.2);

  return { scene, rackLabels };
}
