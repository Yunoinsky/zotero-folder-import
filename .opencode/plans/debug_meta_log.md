# Debug Meta-Log: Zotero Folder Import Plugin

> 本文档记录了 Zotero Folder Import 插件调试过程中积累的经验和教训，供后续 Agent 学习参考。
> 调试时间: 2026-04-13
> 调试助手: OpenCode (MiniMax AI)

---

## 一、Zotero 9 兼容性关键发现

### 1.1 FilePicker API 变更

**问题:** 旧版使用 `nsIFilePicker` (Mozilla XPCOM API) 的代码在 Zotero 9 中无法正常工作。

**症状:** Browse 按钮点击无响应，或文件选择对话框无法正确返回路径。

**根因:** Zotero 9 使用了新的 promise-based `FilePicker` API，位于 `chrome://zotero/content/modules/filePicker.mjs`。

**解决方案:**
```javascript
// 旧 API (不推荐)
const fp = Components.classes['@mozilla.org/filepicker;1']
    .createInstance(Components.interfaces.nsIFilePicker);
fp.init(window, title, fp.modeGetFolder);
const result = fp.show();
if (result === fp.returnOK) {
    const path = fp.file.path;  // nsIFile 对象
}

// 新 API (Zotero 9)
var { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
const fp = new FilePicker();
fp.init(window, title, fp.modeGetFolder);
const result = await fp.show();
if (result === fp.returnOK) {
    const path = fp.file;  // 直接返回字符串
}
```

**关键常量:**
- `fp.modeGetFolder` = 2 (文件夹选择模式)
- `fp.returnOK` = 0 (用户点击确定)

**重要提示:** `ChromeUtils.importESModule` 应在函数内部调用，而非模块顶层，以确保在正确的上下文中执行。

---

### 1.2 Preferences Window 获取

**问题:** 使用 `Zotero.getMainWindows()[0].document` 获取 preferences 窗口的文档失败。

**原因:** `Zotero.getMainWindows()[0]` 返回的是主 Zotero 窗口，不是 preferences 窗口。

**解决方案:**
```javascript
// 方法1: 使用 Services.wm
const prefWindow = Services.wm.getMostRecentWindow('zotero:pref');
if (prefWindow) {
    const doc = prefWindow.document;
}

// 方法2: 从事件目标获取 (推荐用于事件处理器)
public savePrefsFromUI(event?: Event) {
    if (event?.target && (event.target as Element).ownerDocument) {
        const doc = (event.target as Element).ownerDocument;
    }
}
```

---

### 1.3 XUL 事件处理

**问题:** XUL 中的 inline 事件处理器 (`onchange="..."`, `oncommand="..."`) 在 Zotero 9 的远程 XUL 文档中可能无法正常工作。

**症状:** 
- 事件处理器绑定的函数未被调用
- 表单元素的值无法保存

**解决方案:** 使用 JavaScript 动态添加事件监听器：

```javascript
// 在 onload 或 onPrefsLoad 中动态绑定
public onPrefsLoad(event: Event) {
    const target = event.target as Element;
    const doc = target.ownerDocument;
    
    const intervalInput = doc.getElementById('scan-interval');
    if (intervalInput) {
        intervalInput.addEventListener('input', () => this.savePrefsFromUI());
        intervalInput.addEventListener('change', () => this.savePrefsFromUI());
    }
}
```

---

### 1.4 HTML Input vs XUL Textbox

**问题:** Zotero 9 的 preferences pane 可能无法正确渲染 XUL `<textbox>` 元素。

**症状:** textbox 输入框完全不显示。

**解决方案:** 使用 HTML input 元素配合 XHTML 命名空间：

```xml
<vbox xmlns="http://www.w3.org/1999/xhtml"
      xmlns:html="http://www.w3.org/1999/xhtml">
    <html:input id="scan-interval" type="number" min="1" max="3600" />
</vbox>
```

---

## 二、异步编程常见问题

### 2.1 async/await 竞态条件

**问题:** `checkInterval` 函数中 `scanAndImportNewFiles()` 未被 await，导致多个扫描同时运行。

**症状:** 同一个文件被连续导入多次。

**根因:**
```javascript
// 错误代码
const checkInterval = () => {
    if (this.intervalId !== null) {
        this.scanAndImportNewFiles()  // 未 await!
        this.intervalId = setTimeout(checkInterval, intervalMs)
    }
}

// 正确代码
const checkInterval = async () => {
    if (this.intervalId === null) return
    await this.scanAndImportNewFiles()  // 使用 await
    if (this.intervalId !== null) {
        this.intervalId = setTimeout(checkInterval, intervalMs)
    }
}
```

---

### 2.2 isScanning 竞态条件

**问题:** `isScanning` 的检查和设置之间存在时间窗口，多个调用可能同时通过检查。

**解决方案:** 将 `isScanning = true` 移到检查之后的最早位置：

```javascript
public async scanAndImportNewFiles() {
    if (this.isScanning) {
        log.debug('Scan already in progress, skipping')
        return
    }
    this.isScanning = true  //尽早设置

    // 提前检查和返回时需要重置状态
    if (!this.watchFolder) {
        this.isScanning = false  // 重要！
        return
    }
    // ...
}
```

---

## 三、Preferences 持久化

### 3.1 Checkbox 值读取

**问题:** `checkbox.checked || false` 会将 `undefined` 错误地转换为 `false`。

**解决方案:** 使用严格相等：

```javascript
// 错误
const watchEnabled = enabledCheckbox?.checked || false

// 正确
const watchEnabled = enabledCheckbox?.checked === true
```

---

### 3.2 数值输入验证

**问题:** `parseInt` 可能返回 `NaN`，导致后续计算错误。

**解决方案:** 添加 `isNaN` 检查和范围限制：

```javascript
const rawInterval = parseInt(intervalInput?.value || '20', 10)
const scanIntervalSec = isNaN(rawInterval) ? 20 : Math.max(1, Math.min(rawInterval, 3600))
```

---

## 四、调试方法

### 4.1 Zotero 开发者工具测试

在 Zotero 中通过 **Help → Developer → Run JavaScript** 执行测试代码：

```javascript
// 测试 FilePicker API
var { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
console.log("FilePicker 类型:", typeof FilePicker);

// 测试 preferences 窗口
var win = Services.wm.getMostRecentWindow('zotero:pref');
console.log("pref window:", win);
console.log("doc:", win?.document);
var el = win?.document?.getElementById('scan-interval');
console.log("scan-interval element:", el);

// 测试事件目标
var { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
var fp = new FilePicker();
fp.init(window, "Test", fp.modeGetFolder);
fp.show().then(result => {
    console.log("结果:", result, "文件:", fp.file);
});
```

---

### 4.2 调试日志

在关键函数中添加日志：

```typescript
log.debug(`savePrefsFromUI: folder=${watchFolder}, interval=${scanIntervalSec}`)
```

查看日志：在 Zotero 中 **Help → Developer → Debug Output Console → Output**

---

## 五、常见错误模式

| 错误模式 | 症状 | 解决方案 |
|---------|------|---------|
| `ChromeUtils.importESModule` 在顶层调用 | 插件加载失败或行为异常 | 移至函数内部调用 |
| `nsIFilePicker` 文件选择器 | Browse 按钮无响应 | 使用 `FilePicker` 类 |
| inline 事件处理器失效 | 表单值不保存 | 使用 `addEventListener` |
| async 函数未 await | 重复导入、竞态条件 | 确保 await 所有异步调用 |
| `isScanning` 检查在赋值前 | 并发扫描 | 将标志位置于检查后立即设置 |
| `|| false` 用于 boolean | undefined 被错误转换 | 使用 `=== true` |

---

## 六、文件结构参考

### 关键文件

| 文件 | 用途 |
|------|------|
| `bootstrap.ts` | Zotero 插件入口点 |
| `content/folder-import.ts` | 主实现 (PDFWatcher, FolderScanner) |
| `content/preferences.xhtml` | Preferences UI 定义 |
| `esbuild.js` | 构建脚本 |

### Zotero 9 参考

| 资源 | 路径 |
|------|------|
| FilePicker | `chrome://zotero/content/modules/filePicker.mjs` |
| PreferencePanes | `chrome://zotero/content/xpcom/preferencePanes.js` |
| 主窗口类型 | `navigator:browser` |
| Preferences 窗口类型 | `zotero:pref` |

---

## 七、经验总结

1. **Zotero 9 使用了新的 ES Module 系统**，旧的 XPCOM API 可能不再可用或行为不同
2. **始终在函数内部导入模块**，而非顶层，以确保正确的执行上下文
3. **使用动态事件监听器**而非 inline 事件处理器，特别是在 preferences pane 中
4. **async/await 必须配对使用**，忘记 await 是竞态条件的常见原因
5. **布尔值比较使用严格相等** (`=== true`/`=== false`)，而非 `|| false`
6. **添加调试日志**，帮助定位问题

---

**文档结束**

---
VAULT-TEC INDUSTRIES - Building a Better Future... Underground!
*本文档由 OpenCode AI 辅助生成，供调试学习使用。*
