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

### How It Works

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

### Supported File Types

By default, the plugin detects and can import:
- PDF (.pdf)
- Word documents (.docx)
- HTML files (.html)
- OpenDocument files (.odt)
- And any other file types found in the selected folder

---

## Support

For the original plugin: [retorquere/zotero-folder-import](https://github.com/retorquere/zotero-folder-import)

For issues specific to this fork: [Yunoinsky/zotero-folder-import](https://github.com/Yunoinsky/zotero-folder-import)
