# 鸿蒙日志分析工具 v1.0

基于 FastAPI + SQLite 的本地鸿蒙日志分析工具，提供日志加载、多级筛选、双文件对比、结果导出等功能，支持 PyInstaller 打包为独立 exe。

## 功能总览

| 模块 | 功能 |
|------|------|
| 📂 文件管理 | 拖拽/选择加载 .log/.txt，mmap 行偏移索引，支持大文件 |
| 📋 规则管理 | 正则规则 CRUD，支持 JSON 导入导出 |
| 🔍 搜索筛选 | 级别/时间/PID/TID/Tag/关键字多级组合筛选，规则一键搜索 |
| 📊 日志对比 | 双文件规则命中差异 + 级别分布对比 |
| 📤 结果导出 | TXT 原始日志 / JSON 结构化数据导出 |

## 快速开始

### 环境要求

- Python 3.10+
- Windows / macOS / Linux

### 安装运行

```bash
# 克隆项目
git clone git@github.com:YukiAo1/logs_handler.git
cd logs_handler

# 安装依赖
pip install -r requirements.txt

# 启动服务
python main.py
```

启动后浏览器自动打开 `http://127.0.0.1:20306`，将 `.log` 或 `.txt` 文件拖入页面即可开始分析。

### 打包为 exe（可选）

```bash
pip install pyinstaller
python -m PyInstaller build.spec --clean --noconfirm
# 输出: dist/logs_handler.exe (约 15MB)
```

## 使用指南

### 1. 加载日志文件

将日志文件或文件夹拖拽到页面中央的拖放区域，或点击「📂 选择文件」按钮。支持 `.log` / `.txt` 格式，可同时加载多个文件（用于对比）。

文件加载后会在下方显示文件列表，包含文件大小、行数、时间范围。

### 2. 创建筛选规则

左侧「筛选规则」面板 → 点击「+ 新建」→ 输入规则名称和正则表达式。

示例规则：
| 名称 | 正则 | 说明 |
|------|------|------|
| 错误+崩溃 | `ANR\|crash\|fatal` | 捕获 ANR、崩溃、致命错误 |
| 流程日志 | `checkpoint\|onStart\|sync` | 追踪关键流程点 |
| 蓝牙相关 | `bluetooth` | 蓝牙设备连接/断开 |

点击已创建的规则即可一键搜索，再次点击取消。

### 3. 筛选过滤

文件加载后工具栏下方显示筛选栏：

| 控件 | 说明 |
|------|------|
| 级别复选框 | 勾选 V/D/I/W/E/F，默认 I/W/E/F |
| 时间范围 | `MM-DD HH:MM:SS.mmm` 格式 |
| PID / TID | 精确匹配进程/线程 ID |
| Tag | 模糊匹配日志 Tag |
| 关键字 | 支持正则表达式，回车搜索 |

筛选优先级：时间范围（二分定位）→ 级别/PID/Tag → 正则规则/关键字。命中结果支持分页浏览，匹配文本黄色高亮。

### 4. 日志对比

加载至少 2 个文件后，点击工具栏「📊 对比」按钮：

- 选择要对比的规则
- 点击「开始对比」
- 查看规则命中差异（绿色增加/红色减少）
- 查看 V/D/I/W/E/F 级别分布变化

### 5. 导出结果

点击工具栏「📤 导出」：

- **格式**：TXT（原始日志行）或 JSON（结构化数据，含全部解析字段）
- **范围**：可选择已保存规则 + 当前筛选条件组合导出
- 导出文件存放在 `exports/` 目录，浏览器自动下载

## API 文档

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/rules` | 获取规则列表 |
| POST | `/api/rules` | 创建规则 |
| PUT | `/api/rules/{id}` | 更新规则 |
| DELETE | `/api/rules/{id}` | 删除规则 |
| GET | `/api/rules/export` | 导出规则为 JSON |
| POST | `/api/rules/import/upload` | 从 JSON 导入规则 |
| POST | `/api/files/open` | 加载日志文件/目录 |
| GET | `/api/files/info` | 获取已加载文件摘要 |
| POST | `/api/files/close` | 卸载文件 |
| GET | `/api/files/sample` | 预览指定行范围 |
| GET | `/api/files/recent` | 最近打开文件 |
| GET | `/api/search` | 多级组合搜索 |
| GET | `/api/search/count` | 统计规则命中数 |
| POST | `/api/compare` | 双文件对比 |
| POST | `/api/export` | 导出筛选结果 |
| GET | `/api/export/download` | 下载导出文件 |

### 搜索 API 参数

```
GET /api/search?rule_id=1&level=E,F&pid=8001&keyword=crash&time_start=05-22 17:30:00.000&offset=0&limit=500
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `rule_id` | int | 已保存规则 ID |
| `level` | string | 逗号分隔级别，如 `E,F` |
| `pid` | int | 精确 PID |
| `tid` | int | 精确 TID |
| `tag` | string | Tag 模糊匹配 |
| `keyword` | string | 临时关键字/正则 |
| `time_start` | string | `MM-DD HH:MM:SS.mmm` |
| `time_end` | string | `MM-DD HH:MM:SS.mmm` |
| `offset` | int | 分页偏移 |
| `limit` | int | 每页条数（最大 1000） |

## 日志格式

支持以下格式的鸿蒙日志（符合 OHOS Hiview 标准）：

```
MM-DD HH:MM:SS.mmm  PID  TID LEVEL TAG: MESSAGE
```

示例：
```
05-22 17:30:00.003  8912  8923 W A01B01/com.ohos.sceneboard/HOME: battery level: 85%
05-22 17:30:00.017  8821  8876 E B03C01/com.ohos.multimedia/AudioService: ANR detected in main thread
```

## 性能数据

测试环境：Windows 10, Python 3.11, 500K 行 / 45.7MB 日志文件

| 操作 | 耗时 |
|------|------|
| 文件加载 + 建索引 | 2.0s |
| 全量搜索（所有级别） | 1.1s |
| 正则筛选（200K 命中） | 2.2s |
| 双文件对比（150K 行） | 1.5s |
| TXT 导出（25K 行） | < 3s |

## 项目结构

```
logs_handler/
├── main.py              # 入口：启动服务 + 自动打开浏览器
├── config.py            # 全局配置（路径/端口/限制）
├── app.py               # FastAPI 应用工厂 + 路由注册
├── build.spec           # PyInstaller 打包配置
├── requirements.txt     # 依赖清单
├── engine/
│   ├── parser.py        # 正则解析单行日志
│   ├── indexer.py       # mmap 行偏移索引 + 二分时间查找
│   ├── filter_engine.py # 多级筛选引擎
│   └── comparator.py    # 对比引擎（规则命中 + 级别分布）
├── api/
│   ├── rules.py         # 规则 CRUD + 导入导出
│   ├── files.py         # 文件加载/卸载/采样
│   ├── search.py        # 搜索筛选 + 计数
│   ├── compare.py       # 日志对比
│   └── export.py        # 结果导出
├── storage/
│   ├── database.py      # SQLite 连接管理
│   └── models.py        # 数据模型
├── static/
│   ├── index.html       # 深色主题 SPA
│   ├── css/dark.css     # 完整样式表
│   └── js/              # 前端模块（7文件）
└── dist/
    └── logs_handler.exe # PyInstaller 打包产物
```

## 技术栈

- **后端**: FastAPI + Uvicorn + SQLite
- **前端**: Vanilla JS (无框架依赖) + 深色主题 CSS
- **引擎**: mmap 内存映射 + array('Q') 行偏移索引 + re 正则缓存
- **打包**: PyInstaller 6.x, 单文件 exe ~15MB

## License

MIT