# Hi Logs — 技术方案

## 1. 项目概述

### 1.1 项目背景
开发一款鸿蒙（HarmonyOS）应用日志分析工具，用于快速定位问题。日志文件为 `.log` 或 `.txt` 格式，支持同时加载多个文件，单个文件最大不超过 500MB。

### 1.2 目标用户
鸿蒙应用开发/测试工程师，在 Windows 平台上使用。

### 1.3 核心需求

| 需求 | 说明 |
|------|------|
| 快速筛选 | 通过预保存的正则规则一键筛选日志，秒级响应 |
| 保存筛选规则 | 将常用的正则筛选条件（如"开卡流程"）命名保存，方便复用 |
| 多文件支持 | 同时加载多个日志文件，统一搜索 |
| 组合筛选 | 支持时间范围、日志级别、PID、TID、Tag 与正则规则自由组合 |
| 日志对比 | 两份日志按模式统计对比，找出差异 |
| 结果导出 | 筛选结果导出为 txt 或 json 文件 |
| 规则导入导出 | 规则可导出为 JSON，方便团队共享和备份 |
| 深色主题 | 程序员风格的深蓝黑配色 |
| 打包分发 | 打包为单个 exe，无需安装 Python 环境即可运行 |

---

## 2. 技术选型

| 层面 | 技术 | 选型理由 |
|------|------|----------|
| 后端 | Python 3.10+ + FastAPI | 文本处理能力强，开发效率高 |
| 前端 | 纯 HTML/CSS/JS（无框架） | 零 npm 依赖，打包体积小 |
| 数据存储 | SQLite（Python 内置 sqlite3） | 零部署，零配置 |
| 大文件读取 | mmap（Python 内置 mmap 模块） | 操作系统级内存映射，500MB 文件不会全部加载到物理内存 |
| 打包工具 | PyInstaller | 打包为单文件 exe |
| 应用服务器 | uvicorn | FastAPI 官方推荐的 ASGI 服务器 |

---

## 3. 日志格式

### 3.1 格式说明

```
05-22 17:34:55:777  9443  9443 W A01B01/com.ohos.sceneboard/HOME: ABCBCBASAJDALLAD...
```

| 字段 | 示例值 | 说明 |
|------|--------|------|
| 日期 | `05-22` | MM-DD 格式，无年份 |
| 时间 | `17:34:55:777` | HH:MM:SS:mmm 格式 |
| PID | `9443` | 进程 ID |
| TID | `9443` | 线程 ID |
| 级别 | `W` | V(Verbose) / D(Debug) / I(Info) / W(Warn) / E(Error) / F(Fatal) |
| Tag | `A01B01/com.ohos.sceneboard/HOME` | 组件/包名/页面标识 |
| 消息体 | `ABCBCBASAJDALLAD...` | 日志具体内容 |

### 3.2 解析正则

```python
LOG_PATTERN = re.compile(
    r'^(\d{2}-\d{2})\s+'
    r'(\d{2}:\d{2}:\d{2}\.\d{3})\s+'
    r'(\d+)\s+'
    r'(\d+)\s+'
    r'([VDIWEF])\s+'
    r'(\S+):\s+'
    r'(.*)$'
)
```

---

## 4. 系统架构

### 4.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        浏览器 (前端 SPA)                          │
│                                                                 │
│  ┌──────────┐  ┌──────────────────────────┐  ┌───────────────┐ │
│  │ 规则管理  │  │      日志结果视图          │  │  对比视图     │ │
│  │ - 列表    │  │  - 虚拟滚动表格            │  │  - 双栏对比   │ │
│  │ - 新建    │  │  - 正则高亮                │  │  - 差异统计   │ │
│  │ - 编辑    │  │  - 级别颜色标签            │  │              │ │
│  │ - 删除    │  │  - 分页/无限滚动           │  │              │ │
│  │ - 导入导出│  │                           │  │              │ │
│  └──────────┘  └──────────────────────────┘  └───────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    顶部工具栏                              │  │
│  │  [选择文件] [日志级别] [时间范围] [PID/TID] [Tag] [导出▼]  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
          │  HTTP + JSON                    ▲
          ▼                                │
┌─────────────────────────────────────────────────────────────────┐
│                    FastAPI 后端 (Python)                         │
│                                                                 │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────┐ │
│  │ 文件管理   │  │ 规则 CRUD  │  │  搜索筛选   │  │  导出     │ │
│  │ /api/files │  │ /api/rules │  │ /api/search│  │/api/export│ │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬─────┘ │
│        │               │               │               │       │
│  ┌─────┴───────────────┴───────────────┴───────────────┴─────┐ │
│  │                      核心引擎层                             │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │ │
│  │  │ LogParser│ │ LogIndex │ │LogFilter │ │LogComparator │ │ │
│  │  │ 行解析   │ │ mmap索引 │ │ 多级筛选  │ │ 对比引擎     │ │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘ │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                    SQLite 持久化层                          │ │
│  │   filter_rules │ recent_files │ app_settings               │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 数据流向

```
日志文件 → mmap 映射 → 行偏移索引(offsets[]) 
    → 用户触发筛选 → FilterEngine 在索引上筛选 → 返回行号列表
    → 按需解析行(仅匹配的行) → 分页返回前端 → 虚拟滚动表格展示
```

---

## 5. 项目目录结构

```
logs_handler/
├── main.py                     # 入口：启动 uvicorn + 自动打开浏览器
├── config.py                   # 全局配置（端口、数据库路径等）
├── app.py                      # FastAPI 应用工厂（创建 app 实例、注册路由）
├── requirements.txt            # Python 依赖
├── build.spec                  # PyInstaller 打包配置
├── engine/
│   ├── __init__.py
│   ├── parser.py               # 日志行正则解析器 (LogEntry dataclass)
│   ├── indexer.py              # mmap 行偏移索引 (FileIndex)
│   ├── filter_engine.py        # 多级筛选引擎 (FilterEngine)
│   └── comparator.py           # 日志对比引擎 (LogComparator)
├── api/
│   ├── __init__.py
│   ├── files.py                # 文件加载/信息/卸载 API
│   ├── rules.py                # 筛选规则 CRUD + 导入导出 API
│   ├── search.py               # 日志搜索/筛选 API
│   └── export.py               # 结果导出 API
├── storage/
│   ├── __init__.py
│   ├── database.py             # SQLite 连接管理（单例模式）
│   └── models.py               # 数据模型 & 表初始化
├── static/
│   ├── index.html              # SPA 单页面
│   ├── css/
│   │   └── dark.css            # 深色主题样式
│   └── js/
│       ├── api.js              # 后端 API 封装
│       ├── app.js              # 主控制器（页面切换、全局状态）
│       ├── rules.js            # 规则面板逻辑
│       ├── table.js            # 虚拟滚动表格
│       ├── search.js           # 搜索与筛选控制
│       ├── compare.js          # 对比视图
│       └── export.js           # 导出逻辑
├── ForAi/                      # AI 开发辅助目录（不纳入版本控制）
│   ├── scripts/                #   调测脚本
│   ├── test_logs/              #   临时测试日志
│   └── scratch/                #   临时文件、草稿
├── .gitignore                  # Git 忽略规则
└── DESIGN.md                   # 本方案文档
```

---

## 6. 核心模块设计

### 6.1 日志解析器 (`engine/parser.py`)

**职责**：将一行原始日志文本解析为结构化数据。

**数据结构**：
```python
@dataclass
class LogEntry:
    line_no: int       # 原始行号
    offset: int        # 文件偏移（用于 mmap 回读原始行）
    date: str          # "05-22"
    time: str          # "17:34:55.777"
    timestamp: float   # 归一化时间戳（用于排序和范围查询）
    pid: int           # 进程 ID
    tid: int           # 线程 ID
    level: str         # "V" / "D" / "I" / "W" / "E" / "F"
    tag: str           # "A01B01/com.ohos.sceneboard/HOME"
    message: str       # 消息体原始内容
    raw: str           # 完整原始行
```

**关键方法**：
- `parse_line(line: str, line_no: int, offset: int) -> LogEntry | None`
- `parse_lines(lines: list[str]) -> list[LogEntry]` 批量解析

### 6.2 索引器 (`engine/indexer.py`)

**职责**：利用 mmap 建立文件行偏移索引，提供按行号批量读取能力。

**数据结构**：
```python
@dataclass
class FileIndex:
    path: str              # 文件完整路径
    file_size: int         # 文件大小（字节）
    total_lines: int       # 总行数
    offsets: array('Q')    # 行偏移数组（每行起始位置，unsigned long long）
    time_start: str        # 估算的日志起始时间
    time_end: str          # 估算的日志结束时间
```

**关键方法**：
- `index_file(path: str) -> FileIndex` — 遍历文件建立 offsets 数组
- `read_lines(index: FileIndex, line_nos: list[int]) -> list[str]` — 批量读取指定行
- `estimate_time_range(index: FileIndex) -> tuple[str, str]` — 采样首尾估算时间范围

**性能考虑**：
- 500MB 日志文件约 200~500 万行
- offsets 使用 `array('Q')`（C 类型数组），每行占 8 字节，共约 16~40MB
- mmap 由操作系统按需换页，不会真正占用 500MB 物理内存
- 单次遍历建立索引，耗时约 3~5 秒

### 6.3 筛选引擎 (`engine/filter_engine.py`)

**职责**：支持多条件组合的日志筛选，按代价从低到高执行过滤。

**筛选链执行顺序**：

```
1. 时间范围     → 二分查找定位起止行号（O(log n)）
2. 日志级别     → 子集筛选（快速字符串包含）
3. 已保存规则   → 预编译正则匹配（仅对前两步的候选行）
4. PID/TID/Tag  → 按需解析行后再过滤（仅对正则命中的行）
5. 临时关键字   → 正则匹配（最末级）
```

**数据结构**：
```python
@dataclass
class SearchResult:
    items: list[LogEntry]    # 当前页结果
    total_matches: int       # 总匹配数
    offset: int              # 当前偏移
    limit: int               # 每页条数
```

**关键方法**：
- `search(indexes: list[FileIndex], ...) -> SearchResult` — 组合筛选入口
- `_filter_by_pattern(index: FileIndex, pattern: re.Pattern, candidate_lines: list[int]) -> list[int]`

**性能考虑**：
- 正则规则启动时预编译并缓存，避免每次筛选重新编译
- 只对候选行做完整解析，不碰不相关的行
- 分页返回，前端每次请求 500 条

### 6.4 日志对比引擎 (`engine/comparator.py`)

**职责**：将两份日志按时间窗口对齐，按规则模式统计对比，找出差异。

**对比策略**：
- 不按行号逐行比对（两份日志行号不对齐）
- 将两份日志按相同时间段切分成窗口
- 在每个时间窗口内，用用户选定的规则分别统计匹配次数
- 输出对比报告：各规则命中次数差异、日志级别分布变化、异常变化

**数据结构**：
```python
@dataclass
class CompareReport:
    file_a: str
    file_b: str
    time_windows: list[TimeWindowStat]
    summary: CompareSummary

@dataclass
class TimeWindowStat:
    time_start: str
    time_end: str
    rules: dict[str, RuleCompareResult]  # 规则名 → 对比结果

@dataclass
class RuleCompareResult:
    count_a: int
    count_b: int
    delta: int         # B - A
    level_dist_a: dict[str, int]
    level_dist_b: dict[str, int]

@dataclass
class CompareSummary:
    total_lines_a: int
    total_lines_b: int
    level_increased: list[str]   # B 中新增的错误级别
    level_decreased: list[str]   # B 中减少的错误级别
```

---

## 7. 数据库设计

### 7.1 存储机制

SQLite 数据库文件存储在 exe 所在目录（或用户数据目录）下的 `logs_handler.db` 文件。

```
exe 所在文件夹/
├── logs_handler.exe
├── logs_handler.db          ← 持久化存储规则和设置
└── exports/                 ← 导出文件目录
```

### 7.2 表结构

```sql
-- 筛选规则表
CREATE TABLE IF NOT EXISTS filter_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,          -- "开卡日志"
    pattern     TEXT NOT NULL,          -- 正则表达式，如 "abc|def|aaaabcs"
    description TEXT DEFAULT '',        -- 可选备注
    created_at  TEXT NOT NULL,          -- ISO 8601 时间戳
    updated_at  TEXT NOT NULL
);

-- 最近文件记录表
CREATE TABLE IF NOT EXISTS recent_files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    path        TEXT NOT NULL UNIQUE,   -- 文件完整绝对路径
    file_size   INTEGER,               -- 文件大小（字节）
    total_lines INTEGER,               -- 总行数
    time_range  TEXT,                  -- 日志时间范围，如 "05-22 17:30~05-22 18:00"
    opened_at   TEXT NOT NULL          -- 最后打开时间
);

-- 应用设置表（键值对）
CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
```

### 7.3 规则导入导出格式

导出时生成 JSON 文件：

```json
{
    "version": "1.0",
    "exported_at": "2026-05-22T18:00:00",
    "rules": [
        {
            "name": "开卡日志",
            "pattern": "abc|def|aaaabcs",
            "description": "开卡流程关键日志"
        },
        {
            "name": "ANR检测",
            "pattern": "anr|ANR",
            "description": ""
        }
    ]
}
```

导入时支持两种模式：
- **覆盖导入**：清空现有规则，用导入的替换
- **合并导入**：保留现有规则，导入的规则追加（重名则跳过或覆盖）

---

## 8. API 设计

### 8.1 文件管理 API

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/files/open` | 加载文件/目录，返回文件摘要列表 |
| GET | `/api/files/info` | 获取已加载文件列表及索引信息 |
| POST | `/api/files/close` | 卸载指定文件或全部文件 |

**POST /api/files/open 请求体**：
```json
{
    "paths": ["D:\\logs\\app.log", "D:\\logs\\kernel.log"],
    "reload": false
}
```

**响应**：
```json
{
    "files": [
        {
            "path": "D:\\logs\\app.log",
            "file_size": 524288000,
            "total_lines": 2100000,
            "time_start": "05-22 17:30:00.000",
            "time_end": "05-22 18:45:30.500"
        }
    ],
    "total_files": 2,
    "total_lines": 4100000
}
```

### 8.2 规则管理 API

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/rules` | 获取所有规则列表 |
| POST | `/api/rules` | 新建规则 |
| PUT | `/api/rules/{id}` | 更新规则 |
| DELETE | `/api/rules/{id}` | 删除规则 |
| POST | `/api/rules/{id}/test` | 在当前日志上测试某规则的匹配数 |
| GET | `/api/rules/export` | 导出所有规则为 JSON 文件下载 |
| POST | `/api/rules/import` | 从 JSON 文件导入规则 |

### 8.3 搜索筛选 API

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/search` | 日志搜索筛选，返回分页结果 |

**GET /api/search 查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `rule_id` | int | 使用已保存规则的 ID |
| `pattern` | string | 临时正则（与 rule_id 二选一，rule_id 优先） |
| `level` | string | 日志级别过滤，逗号分隔，如 `W,E,F` |
| `pid` | int | 按 PID 过滤 |
| `tid` | int | 按 TID 过滤 |
| `tag` | string | Tag 模糊匹配 |
| `time_start` | string | 时间范围起始，如 `05-22 17:30:00.000` |
| `time_end` | string | 时间范围结束 |
| `offset` | int | 分页偏移（默认 0） |
| `limit` | int | 每页条数（默认 500） |

**响应**：
```json
{
    "items": [
        {
            "line_no": 12345,
            "date": "05-22",
            "time": "17:34:55.777",
            "pid": 9443,
            "tid": 9443,
            "level": "W",
            "tag": "A01B01/com.ohos.sceneboard/HOME",
            "message": "ABCBCBASAJDALLAD...",
            "raw": "05-22 17:34:55:777  9443  9443 W A01B01/..."
        }
    ],
    "total_matches": 1234,
    "offset": 0,
    "limit": 500
}
```

### 8.4 对比 API

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/compare` | 执行对比分析 |

**POST /api/compare 请求体**：
```json
{
    "file_a": "D:\\logs\\normal.log",
    "file_b": "D:\\logs\\error.log",
    "rule_ids": [1, 3],
    "time_start": "05-22 17:30:00.000",
    "time_end": "05-22 18:00:00.000"
}
```

### 8.5 导出 API

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/export` | 导出筛选结果为文件 |

**POST /api/export 请求体**：
```json
{
    "format": "txt",
    "params": {
        "rule_id": 1,
        "level": "W,E,F",
        "time_start": "05-22 17:30:00.000",
        "time_end": "05-22 18:00:00.000"
    }
}
```

### 8.6 最近文件 API

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/recent` | 获取最近打开的文件记录 |

---

## 9. 前端设计

### 9.1 深色主题配色

```
配色方案：
  根背景:    #1a1a2e (深蓝黑)
  面板背景:  #16213e (次级深蓝)
  面板边框:  #0f3460 (深蓝边框)
  主强调色:  #e94560 (玫红，按钮、链接)
  次强调色:  #00b4d8 (青色，次要信息)
  主文字色:  #e0e0e0 (浅灰白)
  次文字色:  #8892b0 (灰蓝，辅助文字)
  输入框背景: #0d1b36
  输入框边框: #2a3f6e
  选中行:    rgba(233, 69, 96, 0.15)

日志级别颜色：
  V(Verbose) - #808080 (暗灰)
  D(Debug)   - #4fc3f7 (亮蓝)
  I(Info)    - #66bb6a (绿)
  W(Warn)    - #ffa726 (橙)
  E(Error)   - #ef5350 (红)
  F(Fatal)   - #ff1744 (深红)

正则高亮：  background: #ffeb3b; color: #1a1a2e;
```

### 9.2 页面布局

```
┌─────────────────────────────────────────────────────────────┐
│  工具栏                                                       │
│  [📂 选择文件] [级别: V▼D I▼W E▼F] [时间: __~__]             │
│  [PID:____] [TID:____] [Tag:________]                        │
│  [📤 导出结果] [📊 对比模式]                      已加载: 3文件│
├─────────────┬───────────────────────────────────────────────┤
│  规则面板    │                                                │
│  240px      │  统计信息栏                                     │
│             │  匹配: 1,234 条 / 总行数: 2,100,000 行          │
│  ┌────────┐ │  ┌──────────────────────────────────────────┐ │
│  │🔍开卡.. │ │  │ 行号    时间      级别 Tag   消息         │ │
│  │abc|def │ │  │ 12345  17:34:55  W   HOME:  abcdef...   │ │
│  ├────────┤ │  │ 12346  17:34:56  I   HOME:  defghi...   │ │
│  │⚡ANR..  │ │  │ 12347  17:34:57  E   HOME:  aaaabc...  │ │
│  ├────────┤ │  │ ...                                     │ │
│  │💥崩溃.. │ │  └──────────────────────────────────────────┘ │
│  │        │ │  分页: ◀ 第 1/3 页 ▶                           │
│  └────────┘ │                                                │
│  [+新建]    │                                                │
│  [📤导出]   │                                                │
│  [📥导入]   │                                                │
├─────────────┴───────────────────────────────────────────────┤
│  状态栏                                                       │
│  已加载: app.log(200MB, 2.1M行) | kernel.log(150MB, 1.5M行)  │
└─────────────────────────────────────────────────────────────┘
```

### 9.3 对比视图布局

```
┌─────────────────────────────────────────────────────────────┐
│  [← 返回搜索]  日志对比                                       │
├──────────────────────┬──────────────────────────────────────┤
│  文件A: normal.log   │  文件B: error.log                     │
│  总行数: 2,100,000    │  总行数: 2,050,000                    │
├──────────────────────┼──────────────────────────────────────┤
│  规则         A    B │  日志级别分布                          │
│  ─────────────────── │  ┌──────────┬────────┬────────┐      │
│  开卡日志  1234 1520 │  │ 级别  │  A     │  B     │      │
│  ANR检测      5    8 │  │  W    │  234  │  311  │      │
│  崩溃日志      3    5 │  │  E    │   15  │   23  │      │
│                      │  │  F    │    0  │    1  │      │
│                      │  └──────────┴────────┴────────┘      │
├──────────────────────┴──────────────────────────────────────┤
│  时间窗口详情（选中行后可展开查看具体统计）                      │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 时间窗口        开卡日志(A/B)  ANR(A/B)  崩溃(A/B)       ││
│  │ 17:30-17:35     200/210        0/0        0/0           ││
│  │ 17:35-17:40     180/220        0/1        0/0           ││
│  │ 17:40-17:45     160/190        1/1        1/1           ││
│  │ ...                                                     ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 9.4 前端技术细节

- **虚拟滚动**：结果表格使用虚拟滚动技术，只渲染可视区域的 DOM 节点，支持 10 万+ 行流畅滚动
- **正则高亮**：消息体中匹配正则的部分用 `<mark>` 标签包裹，在单元格中高亮显示
- **状态管理**：使用简单的全局状态对象管理当前页面的筛选条件、分页位置等
- **无需框架**：纯原生 JS，无 React/Vue/Angular 依赖，打包体积小

---

## 10. 性能设计

### 10.1 关键性能指标

| 指标 | 目标 | 策略 |
|------|------|------|
| 文件加载（500MB） | < 5 秒 | mmap + 单次遍历建索引 |
| 首次规则筛选 | < 3 秒 | 预编译正则 + 候选行集过滤 |
| 切换规则再筛选 | < 2 秒 | 复用已建索引，仅重跑正则 |
| 组合筛选（含时间范围） | < 1 秒 | 二分定位 + 链式过滤 |
| 前端翻页响应 | < 100ms | 只请求当前页数据，500条/页 |
| 规则导入导出 | < 50ms | 数据量极小（几十条规则） |

### 10.2 内存控制

| 数据 | 内存占用（500MB 文件估算） | 说明 |
|------|----------------------------|------|
| mmap 映射 | 0（由 OS 管理） | 操作系统按需换页，不占应用内存 |
| offsets 数组 | 16~40MB | `array('Q')` C类型数组 |
| 分页结果 | ~500KB | 每次只返回 500 条解析结果 |
| FileIndex 元信息 | ~1KB | 路径、大小、行数等 |
| **总计** | **~20~45MB** | 内存完全可控 |

### 10.3 筛选优化策略

```
执行顺序（代价从低到高）：

第1级：时间范围过滤
  └─ 利用 offsets[] 做二分查找，定位起始行和结束行
  └─ 代价：O(log n)，极低

第2级：日志级别过滤
  └─ 在候选行中按级别快速过滤
  └─ 代价：O(m) 字符串比较，低

第3级：正则匹配（已保存规则或临时关键字）
  └─ 对候选行执行预编译正则
  └─ 代价：O(m) 正则匹配，中

第4级：PID/TID/Tag 过滤
  └─ 仅对正则命中的行做完整解析，再按字段过滤
  └─ 代价：O(k) 解析 + 字段比较，中

注：n = 总行数, m = 候选行数, k = 正则命中行数, n >> m >> k
```

---

## 11. 开发规划

### 阶段一：基础骨架 + 规则管理 + 导入导出

**产出**：可运行的程序骨架，深色主题界面，规则完整可用

| 序号 | 任务 | 涉及文件 |
|------|------|----------|
| 1.1 | 创建项目目录结构 | 全部目录 |
| 1.2 | `config.py` 全局配置 | config.py |
| 1.3 | `storage/database.py` SQLite 连接管理 | storage/database.py |
| 1.4 | `storage/models.py` 数据模型 & 建表 | storage/models.py |
| 1.5 | `app.py` FastAPI 应用工厂 | app.py |
| 1.6 | `api/rules.py` 规则 CRUD + 导入导出 API | api/rules.py |
| 1.7 | `static/index.html` 页面骨架（三栏布局） | static/index.html |
| 1.8 | `static/css/dark.css` 深色主题样式 | static/css/dark.css |
| 1.9 | `static/js/api.js` API 封装 | static/js/api.js |
| 1.10 | `static/js/app.js` 主控制器 | static/js/app.js |
| 1.11 | `static/js/rules.js` 规则面板逻辑 | static/js/rules.js |
| 1.12 | `main.py` 入口（启动服务器 + 自动打开浏览器） | main.py |
| 1.13 | `requirements.txt` 依赖清单 | requirements.txt |

**阶段一验收标准**：
- 双击 `main.py` 或直接运行，浏览器自动打开深色主题界面
- 左侧规则面板可新建、编辑、删除规则
- 规则数据持久化到 SQLite，关闭重启不丢失
- 可导出规则为 JSON 文件，可导入 JSON 恢复/合并规则

---

### 阶段二：日志加载与解析核心

**产出**：能加载日志文件并建立索引

| 序号 | 任务 | 涉及文件 |
|------|------|----------|
| 2.1 | `engine/parser.py` 日志行解析器 | engine/parser.py |
| 2.2 | `engine/indexer.py` mmap 行偏移索引 | engine/indexer.py |
| 2.3 | `api/files.py` 文件管理 API | api/files.py |
| 2.4 | 前端：文件选择对话框 + 文件列表展示 | static/js/app.js, index.html |
| 2.5 | 前端：拖拽文件夹到页面加载 | static/js/app.js |

**阶段二验收标准**：
- 通过按钮或拖拽选择日志文件/文件夹
- 后端建立 mmap 索引，前端显示文件摘要（大小、行数、时间范围）
- 可卸载已加载文件
- 最近文件记录自动保存

---

### 阶段三：搜索筛选功能

**产出**：多条件组合筛选，流畅的结果展示

| 序号 | 任务 | 涉及文件 |
|------|------|----------|
| 3.1 | `engine/filter_engine.py` 多级筛选引擎 | engine/filter_engine.py |
| 3.2 | `api/search.py` 搜索筛选 API | api/search.py |
| 3.3 | 前端：工具栏筛选控件（级别/时间/PID/Tag） | static/js/search.js |
| 3.4 | 前端：虚拟滚动表格（日志结果展示） | static/js/table.js |
| 3.5 | 前端：正则高亮渲染 | static/js/table.js |
| 3.6 | 前端：规则面板点击 → 一键筛选 | static/js/rules.js |
| 3.7 | 前端：级别颜色标签 | static/js/table.js |

**阶段三验收标准**：
- 加载日志后，点击规则面板中的规则立即显示匹配结果
- 工具栏支持级别、时间范围、PID、TID、Tag 自由组合筛选
- 规则筛选 + 时间范围组合，秒级响应
- 虚拟滚动表格流畅展示大量结果
- 匹配关键字在消息体中高亮显示

---

### 阶段四：对比与导出

**产出**：日志对比分析、结果导出功能

| 序号 | 任务 | 涉及文件 |
|------|------|----------|
| 4.1 | `engine/comparator.py` 对比引擎 | engine/comparator.py |
| 4.2 | `api/compare.py` 对比 API（或集成到现有路由） | api/compare.py |
| 4.3 | `api/export.py` 导出 API | api/export.py |
| 4.4 | 前端：对比视图（双栏布局 + 统计表格） | static/js/compare.js |
| 4.5 | 前端：导出对话框（选择格式、命名） | static/js/export.js |
| 4.6 | `api/recent.py` 最近文件 API | api/recent.py |

**阶段四验收标准**：
- 加载两份日志，选择规则进行对比
- 对比视图展示各规则命中差异、级别分布变化
- 可导出筛选结果为 txt 或 json 文件
- 规则可导出/导入，便于团队共享

---

### 阶段五：打磨与打包

**产出**：可直接分发的 exe 文件

| 序号 | 任务 | 涉及文件 |
|------|------|----------|
| 5.1 | 启动时自动打开浏览器（webbrowser 模块） | main.py |
| 5.2 | 错误处理与边界情况处理 | 全局 |
| 5.3 | 大文件性能实测与调优 | engine/* |
| 5.4 | `build.spec` PyInstaller 打包配置 | build.spec |
| 5.5 | 打包验证（exe 可否正常运行） | - |

**阶段五验收标准**：
- 双击 exe，自动启动服务 + 打开浏览器
- 单个 500MB 日志文件完整流程（加载→筛选→翻页）< 15 秒
- 多个 500MB 日志文件同时加载，内存不超 200MB
- 所有异常（文件不存在、编码错误等）有友好提示

---

## 12. 依赖清单 (`requirements.txt`)

```
fastapi==0.115.*
uvicorn[standard]==0.34.*
```

**说明**：
- 仅两个核心库，前端零依赖
- SQLite 和 mmap 均为 Python 标准库内置，无需额外安装
- PyInstaller 打包时版本指定需根据 Python 版本适配，不在 requirements.txt 中

---

## 13. 开发环境要求

### 13.1 基础环境

| 环境 | 版本要求 | 说明 |
|------|----------|------|
| Python | 3.10+ | 从 [python.org](https://www.python.org/downloads/) 下载安装 |
| pip | 随 Python 自带 | 安装依赖用 |
| 操作系统 | Windows 10/11 | 目标运行平台 |

### 13.2 安装步骤

```powershell
# 1. 确认 Python 已安装
python --version

# 2. 进入项目目录
cd logs_handler

# 3. 安装依赖
pip install -r requirements.txt

# 4. 启动开发模式
python main.py

# 浏览器自动打开，即可使用
```

### 13.3 打包分发

```powershell
# 安装 PyInstaller
pip install pyinstaller

# 使用 build.spec 打包
pyinstaller build.spec

# 输出: dist/logs_handler.exe
```

---

## 14. 附录：决策记录

| 编号 | 决策项 | 结论 | 理由 |
|------|--------|------|------|
| D01 | 语言 | Python 3.10+ | 开发效率高，文本处理生态好 |
| D02 | UI 形式 | Web UI（FastAPI+浏览器） | 界面灵活，开发快，打包后体验接近原生 |
| D03 | 前端框架 | 无框架，纯 HTML/CSS/JS | 零依赖，打包体积小 |
| D04 | 数据存储 | SQLite（Python 内置 sqlite3） | 零部署，适合单机小数据量 |
| D05 | 大文件读取 | mmap | 不占用应用内存，OS 管理换页 |
| D06 | 主题 | 深色主题（深蓝黑配色） | 程序员习惯 |
| D07 | 规则分类 | 不需要分类，扁平列表 | 规则数量不大（几十条），扁平更直观 |
| D08 | 规则导入导出 | 支持（阶段一完成） | 团队共享、备份迁移需要 |
| D09 | 日志对比 | 基于时间窗口的模式统计对比 | 两份日志行号不对齐，逐行 diff 无意义 |
| D10 | 结果导出 | 支持 txt 和 json 格式 | txt 直接可读，json 便于二次处理 |
| D11 | 打包分发 | PyInstaller 单文件 exe | 目标用户无需安装 Python |