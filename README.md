# IDC 机房数字孪生 · Leaf-Spine

基于 **Three.js** 的 IDC 机房 3D 可视化：5 排机柜、服务器机架（42U，1U/2U/4U 服务器混插）、以及 **Leaf-Spine（叶脊）网络架构**。机柜 / 服务器 / 网络设备数据从 **CMDB（SQLite）** 读取，设备状态用颜色直观表达，面向初级工程师，点击即可查看详情。
[![ScreenShot_2026-08-20_200959_982](https://github.com/user-attachments/assets/4d4af58b-45d1-479c-9add-31627b542b28)](https://github.com/user-attachments/assets/4d4af58b-45d1-479c-9add-31627b542b28)

## 功能

- **CMDB 数据源**：机柜、服务器、交换机、链路全部来自 `cmdb.db`（SQLite），前端通过 `/api/cmdb` 拉取。
- **整间机房总览**：5 排 × 8 柜 = 40 个 42U 机柜，约 950 台服务器（1U/2U/4U 混合）+ 网络区（Spine / Edge / MGMT）。
- **放大单个机柜**：点击机柜飞行到近景，逐台查看柜内服务器；空 U 位显示盲板。
- **状态三色**：`蓝 = 正常`、`黄 = 告警`、`红 = 故障`，故障/告警带呼吸灯。
- **三张网络（可独立开关）**：`内网`（Leaf↔Spine 全互联）、`外网`（Spine↔Edge 出口）、`带外管理网`（MGMT↔全设备），左侧图例点击即可显示/隐藏各层链路。
- **交换机端口面板**：Spine/Edge/MGMT 为机箱式交换机（上行/线卡端口分区、端口 LED），Leaf 为顶部 1U ToR（含一排端口）。
- **IP 定位**：顶部输入业务 IP 或带外管理 IP，自动高亮并飞行聚焦到对应设备。
- **点击详情**：名称 / 类型(1U/2U/4U) / 型号 / 业务 IP / 带外管理 IP / 关联业务 / U 位区间 / 柜内清单。
- **动态演示**：`模拟故障`、`恢复全部`、`自动巡检`。

## 运行

```bash
npm install

# 方式一：单服务（推荐，生产模式，后端托管前端）
npm run build
npm run api            # http://localhost:8787  （API + dist 静态）

# 方式二：开发模式（前端 HMR + 代理）
npm run api            # 终端 1：CMDB 后端 :8787
npm run dev            # 终端 2：Vite :5173（/api 自动代理到 :8787）
```

> 首次启动会自动在项目根目录创建 `cmdb.db` 并写入种子数据（5 排 / 40 柜 / 42U / 1U·2U·4U 服务器 / Leaf-Spine）。
> 若想重置数据：删除 `cmdb.db*` 后重启后端即可。
>
> 安装依赖若遇 npm 缓存只读报错，可加 `--cache <可写目录>`，例如：
> `npm install --cache /root/idc-insight/.npm-cache`

## 操作

| 操作 | 效果 |
| --- | --- |
| 左键拖拽 | 旋转视角 |
| 滚轮 | 缩放 |
| 右键拖拽 | 平移 |
| 点击机柜 / 服务器 / 交换机 / 链路 | 显示详情 + 高亮（链路加粗） |
| 点击机柜 | 放大聚焦到该机柜 |

## 目录结构

```
server/
├── server.js         # CMDB 后端：node:sqlite + http，/api/cmdb + dist 静态
└── seed.js           # 建表 + 种子数据（1U/2U/4U、42U、Leaf-Spine）

src/
├── main.js           # 入口：拉取 CMDB → 初始化场景/动画/巡检
├── constants.js      # 常量：状态、颜色、尺寸、业务字典
├── data.js           # CMDB 归一化 + 状态派生 + 故障模拟
├── scene.js          # 3D 场景构建（可变高度服务器、盲板、Line2 链路）
├── labels.js         # CSS2D 文本标签
├── ui.js             # 统计栏、图例、详情面板、悬浮提示
├── interaction.js    # 射线拾取、高亮、相机聚焦、链路加粗
└── styles.css        # 界面样式

cmdb.db               # SQLite CMDB 数据库（首次运行自动生成）
```

## CMDB 数据模型（SQLite）

| 表 | 说明 |
| --- | --- |
| `rows` | 排（第1排~第5排） |
| `racks` | 机柜（42U，行内位置，型号） |
| `devices` | 网络设备（`type` = leaf / spine / edge / mgmt，含业务 IP + 带外管理 IP） |
| `servers` | 服务器（`u_start` + `u_height`∈{1,2,4}，业务 IP + 带外管理 IP） |
| `links` | 链路（`plane` = lan/wan/oob，`a_id`/`b_id` 两端设备） |

## 技术选型说明

- **前端**：Three.js（WebGL）+ Vite，规则几何体、逐 U 着色与拾取、单页交付。
- **后端 / 数据**：Node 内置 `node:sqlite`（`DatabaseSync`），无第三方原生依赖；暴露 `/api/cmdb` REST 快照，生产模式同时托管 `dist/`。

对接真实 CMDB 时，只需让 `/api/cmdb` 返回相同结构（`rows/racks/servers/devices/links`），前端无需改动。
