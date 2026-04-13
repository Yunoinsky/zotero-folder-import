# Zotero Folder Import 插件修复计划

> 本文档由 VT-OS/OPENCODE 终端生成
> 创建日期: 2026-04-13
> 目标版本: v0.0.14

---

## 一、问题概述

### 用户报告的问题

| # | 问题描述 | 严重程度 |
|---|---------|---------|
| 1 | Browse 按钮点击无效 | 高 |
| 2 | Checkbox 勾选后重启 preferences 后恢复为 false | 高 |
| 3 | PDF Watch Start 无法读取默认路径 | 高 |

### 已知问题（来自代码分析）

| # | 问题 | 严重程度 | 状态 |
|---|------|---------|------|
| B1 | 使用已废弃的 `nsIFilePicker` API | 高 | 需修复 |
| B2 | `FilePicker` 应使用 Zotero 9 的 promise-based API | 高 | 需修复 |
| B3 | Checkbox 事件处理不当 | 高 | 需修复 |
| B4 | Watcher 初始化时未正确读取 prefs | 高 | 需修复 |
| B5 | 多个 `any[]` 类型和不安全类型转换 | 中 | 计划修复 |
| B6 | `parentItemID: false` 应为 `null` | 中 | 计划修复 |
| B7 | 缺少 `IOUtils`/`PathUtils` 导入声明 | 中 | 计划修复 |
| B8 | 空 catch 块吞掉错误 | 低 | 计划修复 |

---

## 二、技术背景

### 2.1 Zotero 9 文件选择器 API 变更

**旧 API (已废弃):**
```javascript
const fp = Components.classes['@mozilla.org/filepicker;1']
    .createInstance(Components.interfaces.nsIFilePicker);
fp.init(window, title, fp.modeGetFolder);
const result = fp.show();
if (result === fp.returnOK) {
    const path = fp.file.path;
}
```

**新 API (Zotero 9):**
```javascript
var { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
const fp = new FilePicker();
fp.init(window, title, fp.modeGetFolder);
const result = await fp.show();
if (result === fp.returnOK) {
    const path = fp.file;  // 直接返回字符串路径
}
```

### 2.2 关键差异

| 特性 | 旧 API | 新 API |
|------|--------|--------|
| 返回类型 | 同步 `show()` | Promise-based `await fp.show()` |
| 文件路径 | `fp.file.path` (nsIFile 对象) | `fp.file` (字符串) |
| 导入方式 | Components XPCOM | ChromeUtils ESModule |
| 事件模型 | 阻塞 | 非阻塞 |

### 2.3 Window 获取模式

Zotero 9 中获取主窗口的标准模式：
```javascript
// 推荐方式
var { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
const fp = new FilePicker();
fp.init(window, title, mode);  // 直接使用传入的 window 引用
```

---

## 三、分步修复计划

### 阶段 1: Preference Pane 修复（用户报告的问题）

#### 步骤 1.1: 添加 FilePicker 导入

**目标:** 在 `content/folder-import.ts` 中添加 FilePicker 导入

**文件:** `content/folder-import.ts`

**修改位置:** 文件顶部，其他 import 语句附近

**修改内容:**
```typescript
// 在现有 import 附近添加
var { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs')
```

**测试方法:**
```javascript
// 在 Zotero 开发者工具中执行
try {
    var { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
    console.log("FilePicker 导入成功:", typeof FilePicker);
} catch (e) {
    console.error("FilePicker 导入失败:", e);
}
```

**验证标准:**
- 无 JavaScript 错误
- `FilePicker` 类型为 `function`

---

#### 步骤 1.2: 重构 `browseWatchFolder()` 函数

**目标:** 使用 Zotero 9 的 FilePicker API 替代废弃的 nsIFilePicker

**文件:** `content/folder-import.ts`

**当前代码位置:** 第 740-773 行

**当前代码:**
```typescript
public browseWatchFolder() {
    const fp = Components.classes['@mozilla.org/filepicker;1'].createInstance(
      Components.interfaces.nsIFilePicker,
    )
    const windows = Zotero.getMainWindows()
    const prefWin = windows.length > 0 ? windows[0] : null
    if (!prefWin) return

    fp.init(prefWin, 'Select Watch Folder', fp.modeGetFolder)
    fp.appendFilters(fp.filterAll)

    if (fp.show() === fp.returnOK) {
      const folderPath = fp.file.path
      // ... 后续代码
    }
}
```

**修改后代码:**
```typescript
public async browseWatchFolder() {
    const windows = Zotero.getMainWindows()
    const prefWin = windows.length > 0 ? windows[0] : null
    if (!prefWin) {
        log.error('No preference window found')
        return
    }

    const fp = new FilePicker()
    fp.init(prefWin, 'Select Watch Folder', fp.modeGetFolder)
    fp.appendFilters(fp.filterAll)

    const result = await fp.show()
    if (result === fp.returnOK) {
      const folderPath = fp.file
      Zotero.Prefs.set(
        'extensions.zotero.folder-import.watchFolder',
        folderPath,
      )
      this.watcher.setWatchFolder(folderPath)

      const folderInput = prefWin.document.getElementById(
        'watch-folder',
      ) as HTMLInputElement
      if (folderInput) {
        folderInput.value = folderPath
      }

      const statusLabel = prefWin.document.getElementById(
        'status-label',
      ) as HTMLInputElement
      if (statusLabel) {
        statusLabel.value = `Status: Stopped | Folder: ${folderPath} | Processed: ${this.watcher.getProcessedFilesCount()}`
      }
    }
}
```

**测试方法:**
```javascript
// 在 Zotero 开发者工具中执行 - 验证 FilePicker 可以正常打开
var { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
var fp = new FilePicker();
fp.init(window, "Test Folder Picker", fp.modeGetFolder);
fp.show().then(result => {
    console.log("FilePicker 结果:", result, "文件:", fp.file);
}).catch(e => console.error("错误:", e));
```

**验证标准:**
- 文件夹选择对话框正常打开
- 选择文件夹后，路径被正确返回
- 取消选择时无错误

---

#### 步骤 1.3: 修复 Checkbox 持久化问题

**目标:** 确保 checkbox 状态正确保存到 Zotero Prefs

**文件:** `content/folder-import.ts`

**问题分析:**
- `oncommand` 事件可能在 checkbox 状态更新前触发
- `savePrefsFromUI()` 使用 `|| false` 会将 `undefined` 转为 `false`

**当前代码 (第 714-720 行):**
```typescript
const enabledCheckbox = doc.getElementById(
  'watch-enabled',
) as HTMLInputElement
// ...
const watchEnabled = enabledCheckbox?.checked || false
```

**修改后代码:**
```typescript
const enabledCheckbox = doc.getElementById(
  'watch-enabled',
) as HTMLInputElement | null
// ...
const watchEnabled = enabledCheckbox?.checked === true
```

**额外检查:** 确认 XUL 中 checkbox 的 `oncommand` 事件正确绑定：
```xml
<!-- content/preferences.xhtml 第 17 行 -->
<checkbox id="watch-enabled" label="Auto-start PDF Watch on Zotero launch" oncommand="Zotero.FolderImport.savePrefsFromUI()" />
```

**测试方法:**
```javascript
// 在 Zotero 开发者工具中执行
var checkbox = document.getElementById('watch-enabled');
console.log("Checkbox 元素:", checkbox);
console.log("初始 checked 状态:", checkbox?.checked);

// 模拟点击
if (checkbox) {
    checkbox.checked = true;
    console.log("设置后 checked 状态:", checkbox.checked);
}
```

**验证标准:**
- 勾选 checkbox 后，prefs 中值变为 `true`
- 重启 preferences 后，checkbox 保持勾选状态

---

#### 步骤 1.4: 修复 Textbox 持久化问题

**目标:** 确保 textbox 值在用户输入时正确保存

**文件:** `content/folder-import.ts`

**问题分析:**
- `onchange` 只在输入框失去焦点且值改变时触发
- 如果用户输入后直接关闭 pane，事件可能不触发

**当前代码 (content/preferences.xhtml):**
```xml
<textbox id="watch-folder" flex="1" onchange="Zotero.FolderImport.savePrefsFromUI()" />
<textbox id="scan-interval" width="80" onchange="Zotero.FolderImport.savePrefsFromUI()" />
```

**建议修改:** 添加 `oninput` 事件以捕获即时输入：
```xml
<textbox id="watch-folder" flex="1" onchange="Zotero.FolderImport.savePrefsFromUI()" oninput="Zotero.FolderImport.savePrefsFromUI()" />
<textbox id="scan-interval" width="80" onchange="Zotero.FolderImport.savePrefsFromUI()" oninput="Zotero.FolderImport.savePrefsFromUI()" />
```

**额外修复 (folder-import.ts 第 718-719 行):**
```typescript
// 添加 NaN 检查
const scanIntervalSec = parseInt(intervalInput?.value || '20', 10)
const validInterval = isNaN(scanIntervalSec) ? 20 : Math.max(1, Math.min(scanIntervalSec, 3600))
```

---

#### 步骤 1.5: 修复 Watcher 初始化逻辑

**目标:** 确保 `startWatching()` 正确读取默认路径

**文件:** `content/folder-import.ts`

**问题分析:**
- 第 570 行 `this.watcher.getWatchFolder()` 在 watcher 未初始化时返回空字符串
- 默认路径构建逻辑 (第 576-586 行) 可能因为 `Services.dirsvc` 失败而返回空

**当前代码 (第 569-594 行):**
```typescript
public startWatching() {
    let folder = this.watcher.getWatchFolder()
    if (!folder) {
      folder = Zotero.Prefs.get(
        'extensions.zotero.folder-import.watchFolder',
      ) as string
    }
    if (!folder) {
      try {
        const homeDir = Services.dirsvc.get(
          'Home',
          Components.interfaces.nsIFile,
        ).path
        folder = OS.Path.join(OS.Path.join(homeDir, 'Downloads'), 'papers')
      }
      catch (e) {
        folder = ''
      }
    }
    if (!folder) {
      Services.prompt.alert(
        null,
        'No Watch Folder',
        'Please set a watch folder first in Preferences',
      )
      return
    }
    // ...
}
```

**修改后代码:**
```typescript
public startWatching() {
    // 首先尝试从 prefs 读取
    let folder = Zotero.Prefs.get(
      'extensions.zotero.folder-import.watchFolder',
    ) as string

    // 如果 prefs 为空，尝试 watcher 中已设置的值
    if (!folder) {
      folder = this.watcher.getWatchFolder()
    }

    // 如果仍然为空，尝试获取默认路径
    if (!folder) {
      try {
        const homeDir = Services.dirsvc.get(
          'Home',
          Components.interfaces.nsIFile,
        ).path
        folder = OS.Path.join(
          OS.Path.join(homeDir, 'Downloads'),
          'papers',
        )
        log.info(`Using default watch folder: ${folder}`)
      }
      catch (e) {
        log.error('Could not get home directory:', e)
      }
    }

    // 最终检查
    if (!folder) {
      Services.prompt.alert(
        null,
        'No Watch Folder',
        'Please set a watch folder first in Preferences',
      )
      return
    }

    // 设置并启动 watcher
    this.watcher.setWatchFolder(folder)
    const intervalSec = (Zotero.Prefs.get(
      'extensions.zotero.folder-import.watchIntervalSec',
    ) as number) || 20
    this.watcher.setLibraryID(Zotero.Libraries.userLibraryID)
    this.watcher.startWatching((intervalSec as number) * 1000)
    Services.prompt.alert(
      null,
      'PDF Watch Started',
      `Watching folder: ${folder}\nInterval: ${intervalSec}s`,
    )
}
```

**测试方法:**
```javascript
// 在 Zotero 开发者工具中执行 - 验证 Services.dirsvc
try {
    var dirSvc = Components.classes['@mozilla.org/file/directory_service;1']
        .getService(Components.interfaces.nsIProperties);
    var homeDir = dirSvc.get('Home', Components.interfaces.nsIFile);
    console.log("Home 目录路径:", homeDir.path);
} catch (e) {
    console.error("获取 Home 目录失败:", e);
}
```

**验证标准:**
- 不设置任何 prefs 时，启动 PDF Watch 应使用 `~/Downloads/papers` 作为默认路径
- 路径存在时正常启动，不存在时提示用户设置

---

### 阶段 2: 类型和代码质量修复

#### 步骤 2.1: 修复 `parentItemID: false` 问题

**文件:** `content/folder-import.ts`

**位置:** 第 132 行

**当前代码:**
```typescript
const item = await Zotero.Attachments.linkFromFile({
    file,
    parentItemID: false,  // 应为 null 或 undefined
    collections: collection ? [collection.id] : undefined,
})
```

**修改后:**
```typescript
const item = await Zotero.Attachments.linkFromFile({
    file,
    parentItemID: undefined,
    collections: collection ? [collection.id] : undefined,
})
```

---

#### 步骤 2.2: 添加类型注解

**文件:** `content/folder-import.ts`

**位置:** 第 68 行

**当前代码:**
```typescript
public selected(extensions) {
```

**修改后:**
```typescript
public selected(extensions: Set<string>): number {
```

---

#### 步骤 2.3: 修复类型断言

**文件:** `content/folder-import.ts`

**位置:** 多处 (第 671, 674, 677, 700, 770 行)

**当前代码:**
```typescript
;(folderInput as HTMLInputElement).value = watchFolder
```

**修改后:** 添加空值检查
```typescript
if (folderInput instanceof HTMLInputElement) {
    folderInput.value = watchFolder
}
```

---

### 阶段 3: 错误处理改进

#### 步骤 3.1: 修复空 catch 块

**文件:** `content/folder-import.ts`

**位置:** 第 845-848 行

**当前代码:**
```typescript
catch (err) {}
```

**修改后:**
```typescript
catch (err) {
    log.debug(`Failed to remove temp file ${duplicates}: ${err}`)
}
```

---

## 四、测试计划

### 4.1 测试环境准备

```javascript
// 测试 1: 验证 FilePicker API
var { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
console.log("FilePicker 类型:", typeof FilePicker);
console.log("modeGetFolder:", FilePicker.prototype.modeGetFolder);
console.log("returnOK:", FilePicker.prototype.returnOK);
```

### 4.2 分步测试

| 步骤 | 测试内容 | 预期结果 | 验证方法 |
|------|---------|---------|---------|
| 1.1 | FilePicker 导入 | 无错误，类型为 function | console.log |
| 1.2 | Browse 按钮 | 对话框打开，选择后路径返回 | 实际点击测试 |
| 1.3 | Checkbox 持久化 | 勾选后重启保持 | 重启 preferences |
| 1.4 | Textbox 持久化 | 输入后重启保持 | 重启 preferences |
| 1.5 | 默认路径 | 未设置时使用 ~/Downloads/papers | console.log + 实际测试 |

### 4.3 回归测试

修改后需要验证：
1. 手动导入文件夹功能仍然正常
2. PDF Watch Start/Stop 正常工作
3. Clear History 功能正常

---

## 五、风险评估

### 高风险项

| 项 | 风险 | 缓解措施 |
|----|------|---------|
| FilePicker API 变更 | 可能破坏文件选择功能 | 步骤 1.1 先验证 API 可用性 |
| async/await 变更 | 可能导致竞态条件 | 仔细测试 start/stop 序列 |

### 中风险项

| 项 | 风险 | 缓解措施 |
|----|------|---------|
| checkbox 事件处理 | 可能无法捕获所有状态变更 | 使用 `oninput` + `onchange` 双绑定 |
| 默认路径构建 | macOS 路径格式可能不同 | 添加日志输出路径供调试 |

### 低风险项

| 项 | 风险 | 缓解措施 |
|----|------|---------|
| 类型注解添加 | 不影响运行时行为 | 编译时检查 |

---

## 六、实施顺序

```
[阶段 1: Preference Pane 修复]
    │
    ├── 步骤 1.1: 添加 FilePicker 导入
    │       └── 测试: 验证导入成功
    │
    ├── 步骤 1.2: 重构 browseWatchFolder()
    │       └── 测试: 验证文件选择器可用
    │
    ├── 步骤 1.3: 修复 Checkbox 持久化
    │       └── 测试: 勾选后重启验证
    │
    ├── 步骤 1.4: 修复 Textbox 持久化
    │       └── 测试: 输入后重启验证
    │
    └── 步骤 1.5: 修复 Watcher 初始化
            └── 测试: 验证默认路径逻辑

[阶段 2: 类型和代码质量]
    │
    ├── 步骤 2.1: 修复 parentItemID
    ├── 步骤 2.2: 添加类型注解
    └── 步骤 2.3: 修复类型断言

[阶段 3: 错误处理]
    │
    └── 步骤 3.1: 修复空 catch 块

[最终验证]
    │
    ├── npm run lint
    ├── npm run build
    └── 完整功能测试
```

---

## 七、用户操作流程

1. **步骤 1.1 完成后:**
   - 您在 Zotero 开发者工具中运行测试代码验证 FilePicker API

2. **步骤 1.2 完成后:**
   - 运行 `npm run build`
   - 安装新 XPI
   - 测试 Browse 按钮

3. **步骤 1.3-1.4 完成后:**
   - 运行 `npm run build`
   - 安装新 XPI
   - 测试 Checkbox 和 Textbox

4. **步骤 1.5 完成后:**
   - 运行 `npm run build`
   - 安装新 XPI
   - 测试 PDF Watch Start 不设置路径时的行为

5. **所有步骤完成后:**
   - 运行 `npm run lint` 验证代码风格
   - 运行 `npm run build` 验证编译
   - 执行完整功能测试

---

## 八、文档更新

修复完成后需要更新以下文件：
- `README.md` - 如有功能变更
- `CHANGELOG.md` - 记录修复的问题 (如存在)

---

## 九、附录

### A. 相关文件

| 文件 | 用途 |
|------|------|
| `content/folder-import.ts` | 主实现文件 |
| `content/preferences.xhtml` | Preferences UI 定义 |
| `bootstrap.ts` | 插件入口点 |

### B. Zotero 9 参考资料

- FilePicker: `chrome://zotero/content/modules/filePicker.mjs`
- PreferencePanes: `chrome://zotero/content/xpcom/preferencePanes.js`
- 主窗口: `Services.wm.getMostRecentWindow('navigator:browser')`

### C. 关键 API 差异

```javascript
// 旧 (nsIFilePicker)
fp.show()              // 同步返回
fp.file.path           // nsIFile 对象，需 .path

// 新 (FilePicker)
await fp.show()        // 异步返回 Promise
fp.file                // 直接是字符串路径
```

---

**文档结束**

---
VAULT-TEC INDUSTRIES - 准备未来！
*Vault-Tec 对任何意外的数据丢失、ghoulification 或存在性恐惧不承担责任。*
