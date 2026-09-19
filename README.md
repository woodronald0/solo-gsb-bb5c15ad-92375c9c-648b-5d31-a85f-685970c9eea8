# 字幕脱敏审校台（Subtitle Mask Console）

本机完成的 WebVTT 字幕正则脱敏工具：粘贴带时间码的 VTT → 配置姓名 / 电话 / 证件等正则规则 →
按优先级合并重叠命中并保留原始时间轴 → 逐条撤销 / 重新应用 → 确认后导出**新 VTT** 与
**JSON 审计文件**。任务自动保存在本机，刷新页面或重启服务后可恢复。

技术栈：React 18 + TypeScript + Vite（前端）、Node.js 20 + Express + TypeScript（后端）。
所有计算均在浏览器请求的本机服务中完成，**不向任何外部服务发送字幕内容**。

## 一键启动（Docker Compose）

```bash
docker compose up -d --build
```

依赖安装、前后端构建、服务启动均在镜像内自动完成，无需手动初始化。

启动后访问：

- 地址：<http://localhost:3000>
- 端口：容器内 `3000`，宿主机默认也是 `3000`（可用 `HOST_PORT` 修改）

停止：

```bash
docker compose down        # 保留任务数据（Docker 卷 subtitle-mask-data）
docker compose down -v     # 同时清除本机保存的任务
```

## 本地开发（不用 Docker）

要求 Node.js ≥ 20。

```bash
npm install                 # 安装全部 workspace 依赖

# 终端 1：后端（监听 3001，文件持久化到 server/data/）
npm run dev:server

# 终端 2：前端 Vite（监听 5173，/api 代理到 3001）
npm run dev:web
```

访问 <http://localhost:5173>。

生产构建与运行（服务自身托管前端静态文件，监听 3000）：

```bash
npm run build
npm start
# 打开 http://localhost:3000
```

其他命令：

```bash
npm run typecheck     # 前后端类型检查
npm run test:engine   # 脱敏引擎自测（8 项：命中/合并/撤销/时间轴/审计等）
```

## 配置

无需任何必填配置。可选环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST_PORT` | `3000` | 仅 Compose 使用，宿主机映射端口（`.env` 可改） |
| `PORT` | `3000` | 后端监听端口（开发模式下脚本固定为 3001） |
| `DATA_DIR` | `./data`（Docker 中为 `/app/data`） | 任务持久化目录，单个 `job.json` 原子写入 |

## 使用流程

1. **粘贴 VTT**：将带时间码的 WebVTT 粘入左侧编辑框（可点「载入示例」体验）。
   NOTE / STYLE / REGION 块、cue id、时间行与内联标签都会保留，只替换文本。
2. **配置规则**：从内置预设一键添加（手机号、邮箱、身份证、银行卡、姓名等），或新建自定义规则。
3. **审校预览**：右侧自动计算（300ms 防抖）。命中片段高亮显示原文 → 替换结果；
   重叠命中按规则处理（见下），被吞并项以紫色「重叠抑制」提示并写入审计。
4. **逐条撤销**：点命中片段上的「撤销」恢复该处原文，或顶部「全部撤销 / 全部应用」。
5. **确认导出**：点右上「④ 确认并导出」，分别下载：
   - `desensitized-<时间戳>.vtt`：脱敏后字幕（CRLF，时间轴原样）
   - `desensitized-<时间戳>.json`：审计报告

任务在编辑时自动保存（800ms 防抖）到服务端 `data/job.json`，**刷新页面、重启容器后自动恢复**。

### 优先级与重叠合并

- 所有规则同时扫描，命中按 **优先级数值降序** 排序；数值相同取**更长匹配**，再相同按规则名。
- 贪心选择互不重叠的区间：后处理的命中若与已入选命中重叠，则被抑制（suppressed），
  仅记录到审计 JSON，不执行替换。例如身份证（80）与银行卡（75）在同一段 18 位数字上重叠时，
  身份证规则胜出。

### 替换模板

| 占位符 | 含义 |
| --- | --- |
| `$&` | 整体命中 |
| `$1` `$2` … | 捕获组（支持 `$<name>` 命名组） |
| `$KEEP:3` | 保留命中前 3 个字符，其余打码（空白保留），如 `138****5678` |
| `$MASK:2` | 仅前 2 个字符打码 |
| `$MASKALL` | 整体打码 |
| `$RULE` | 规则名 |

正则标志中 `g` 会自动补齐；支持 `i`、`u`、`s` 等标准标志。无效正则会在界面与预览中提示，不会中断处理。

## 审计 JSON 结构

```jsonc
{
  "app": "subtitle-mask-console",
  "version": 1,
  "generatedAt": "2026-09-19T06:13:00.000Z",
  "source": { "sha256": "…原文哈希…", "length": 92, "cueCount": 1 },
  "rules": [ /* 导出时生效的完整规则集 */ ],
  "stats": { "totalHits": 3, "appliedHits": 2, "revertedHits": 1, "suppressedHits": 1 },
  "records": [
    {
      "cueIndex": 0,
      "cueId": "",
      "time": { "start": "00:00:00.000", "end": "00:00:03.000" },
      "rule": { "id": "a", "name": "手机号", "priority": 50 },
      "source": { "start": 5, "end": 15, "text": "13812345678" }, // 原文区间（文本偏移）
      "replacement": "138****5678",                                // 替换结果
      "status": "reverted"                                         // applied / reverted / suppressed
    }
  ]
}
```

## 目录结构

```
.
├── docker-compose.yml      # 一键启动
├── Dockerfile              # 依赖安装 + 前后端构建 + 运行
├── server/                 # Node.js + Express + TypeScript
│   └── src/
│       ├── vtt.ts          # WebVTT 解析 / 序列化（保留时间轴与头部）
│       ├── engine.ts       # 规则编译、优先级合并、预览、导出、审计
│       ├── engine.test.ts  # 引擎自测
│       ├── presets.ts      # 内置规则预设与示例 VTT
│       ├── store.ts        # 本机文件持久化（原子写）
│       └── index.ts        # API 与静态资源服务
└── web/                    # React + TypeScript + Vite
    └── src/
        ├── App.tsx         # 状态编排、防抖预览、自动保存、恢复
        └── components/     # VTT 输入、规则面板、预览、导出弹层
```
