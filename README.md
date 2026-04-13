# Folder Import (Zotero Plugin)

[Original by retorquere](https://github.com/retorquere/zotero-folder-import) | [Fork by Yunoinsky](https://github.com/Yunoinsky/zotero-folder-import)

## Installation

Install by downloading the [latest version](https://github.com/Yunoinsky/zotero-folder-import/releases/latest).

You can use the .xpi file from the link above to install in the Zotero standalone app:
* Open the Zotero "Tools" menu
* Select "Add-ons"
* Open the gear menu in the top right
* Select "Install Add-on From File..." .

## Features

Import folder of attachments into a collection hierarchy. Select **"Add Files from Folder"** from the file menu.

### This Fork's Improvements

| Feature | Original | This Fork |
|---------|----------|-----------|
| Collection requirement | Must select a collection | Collection is optional (imports as unfiled if none selected) |
| Extension selection | Manual prompt every time | Auto-selects all detected extensions by default |
| Import mode | Link mode for some library types | Defaults to **copy** (stored) mode |
| PDF Watch | Not supported | **Continuous folder monitoring** - auto-imports new PDFs |

### How It Works

#### Manual Import

1. Select **File → Add Files from Folder...** in Zotero
2. Choose a folder containing PDF files (or other supported files)
3. The plugin will:
   - Scan the folder recursively
   - Detect all file extensions
   - **Automatically select all extensions** (no manual selection needed)
   - **Import files as copies** (stored in Zotero storage) by default
   - Create collection hierarchy matching your folder structure
   - **Auto-recognize metadata** for PDF files (extracts DOI, title, etc.)
4. If no collection is selected, files are imported as unfiled items

#### PDF Watch (Continuous Monitoring)

The plugin can continuously monitor a folder for new PDF files:

1. Select **Tools → PDF Watch: Set Folder…**
2. Choose the folder to watch (e.g., `~/Downloads/papers`)
3. Select **Tools → PDF Watch: Start** to begin monitoring
4. New PDFs added to the folder will be automatically imported and metadata will be recognized
5. Select **Tools → PDF Watch: Stop** to stop monitoring

**Features:**
- Automatically avoids duplicate imports (tracks processed files)
- Auto-recognizes metadata for imported PDFs
- Configurable check interval (default: 5 seconds)
- Persists state across Zotero restarts

### Supported File Types

By default, the plugin detects and can import:
- PDF (.pdf)
- Word documents (.docx)
- HTML files (.html)
- OpenDocument files (.odt)
- And any other file types found in the selected folder

---

## Menu Options

| Menu | Option | Description |
|------|--------|-------------|
| File | Add Files from Folder… | One-time import from selected folder |
| Tools | PDF Watch: Start | Start continuous folder monitoring |
| Tools | PDF Watch: Stop | Stop folder monitoring |
| Tools | PDF Watch: Set Folder… | Set the folder to watch |
| Tools | PDF Watch: Status | Show current watch status |

---

## Technical Details

### Processed Files Tracking

The plugin tracks processed file paths in Zotero preferences to avoid duplicate imports. This tracking persists across sessions but can be cleared if needed.

### Metadata Recognition

PDF metadata is extracted using Zotero's built-in `Zotero.RecognizeDocument.autoRecognizeItems()`, which attempts to:
1. Extract DOI from PDF
2. Query metadata from CrossRef/other sources
3. Create parent item with metadata

If metadata recognition fails, the PDF will still be imported as a standalone attachment.

---

## Support

For the original plugin: [retorquere/zotero-folder-import](https://github.com/retorquere/zotero-folder-import)

For issues specific to this fork: [Yunoinsky/zotero-folder-import](https://github.com/Yunoinsky/zotero-folder-import)
