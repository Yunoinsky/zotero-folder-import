declare var Zotero: any // eslint-disable-line no-var
declare const Services: any
declare const Components: any
declare const ChromeUtils: any

import { FilePickerHelper, ZoteroToolkit } from 'zotero-plugin-toolkit'
const ztoolkit = new ZoteroToolkit()

import { DebugLog as DebugLogSender } from 'zotero-plugin/debug-log'
import { log } from './debug'

declare const OS: {
  Path: {
    basename: (path: string) => string
    join: (path: string, name: string) => string
  }
  File: {
    DirectoryIterator: (path: string) => void // Iterable<DirectoryEntry>
    remove: (path: string) => Promise<void>
    exists: (path: string) => Promise<boolean>
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

class FolderScanner {
  files: string[] = []
  folders: FolderScanner[] = []
  extensions: Set<string> = new Set()

  name: string

  constructor(public path: string, isRoot: boolean) {
    log.info(`scanning ${path}`)
    this.path = path
    this.name = isRoot ? '' : PathUtils.filename(path)
  }

  public async scan() {
    for (const entry of (await IOUtils.getChildren(this.path))) {
      const info = await IOUtils.stat(entry)
      if (info.type === 'directory') {
        this.folders.push(new FolderScanner(entry, false))
      }
      else {
        log.info(`${this.path}: file ${JSON.stringify(entry)}`)
        this.files.push(entry)
        const ext = this.extension(entry)
        if (ext && ext !== 'lnk') this.extensions.add(ext)
      }
    }

    await Promise.all(this.folders.map(dir => dir.scan()))
    for (const dir of this.folders) {
      this.extensions = new Set([...this.extensions, ...dir.extensions])
    }
    log.info(`scanned ${this.path}: ${JSON.stringify(Array.from(this.extensions))}`)
  }

  public selected(extensions) {
    let selected = this.files.filter(f => extensions.has(this.extension(f))).length
    for (const folder of this.folders) {
      selected += folder.selected(extensions)
    }
    return selected
  }

  public async import(params, collection, pdfs, duplicates: Set<string>) {
    // don't do anything if no selected extensions exist in this folder
    if (![...this.extensions].find(ext => params.extensions.has(ext))) return

    log.info(`importing path ${this.path}`)

    if (this.name) {
      const existing = (collection ? collection.getChildCollections() : Zotero.Collections.getByLibrary(params.libraryID)).find(child => child.name === this.name)

      if (existing) {
        log.info(`${this.name} exists under ${collection ? collection.name : 'the selected library'}`)
        collection = existing
      }
      else {
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands, prefer-template
        log.info(`${this.name} does not exist, creating${collection ? ' under ' + collection.name : ''}`)
        const parentKey = collection ? collection.key : undefined
        collection = new Zotero.Collection()
        collection.libraryID = params.libraryID
        collection.name = this.name
        collection.parentKey = parentKey
        await collection.saveTx()
        log.info(`${this.name} created`)
        await sleep(10) // eslint-disable-line @typescript-eslint/no-magic-numbers
        log.info(`${this.name} loaded`)
      }
    }
    if (collection) await collection.loadAllData()

    for (const file of this.files.sort()) {
      if (!params.extensions.has(this.extension(file))) {
        log.info(`not importing ${file} with extension ${this.extension(file)}`)
        continue
      }
      if (duplicates.has(file)) {
        log.info(`not importing duplicate ${file}`)
        continue
      }

      try {
        if (params.link) {
          log.info(`linking ${file} into ${collection ? collection.name : '<root>'}`)
          const item = await Zotero.Attachments.linkFromFile({
            file,
            parentItemID: false,
            collections: collection ? [collection.id] : undefined,
          })
          if (file.toLowerCase().endsWith('.pdf')) pdfs.push(item)
        }
        else if (file.endsWith('.lnk')) {
          log.info(`not importing ${file} with extension ${this.extension(file)}`)
        }
        else {
          log.info(`importing ${file} into ${collection ? collection.name : '<root>'}`)
          const item = await Zotero.Attachments.importFromFile({
            file,
            libraryID: params.libraryID,
            collections: collection ? [collection.id] : undefined,
          })
          if (file.toLowerCase().endsWith('.pdf')) pdfs.push(item)
        }
      }
      catch (err) {
        log.error(err)
      }

      await sleep(10) // eslint-disable-line @typescript-eslint/no-magic-numbers
      params.progress.update()
    }

    for (const folder of this.folders) {
      await folder.import(params, collection, pdfs, duplicates)
    }
  }

  private extension(path: string): false | string {
    const name: string = PathUtils.filename(path)
    if (name[0] === '.') return false
    const parts: string[] = name.split('.')
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : false
  }
}

class PDFWatcher {
  private intervalId: ReturnType<typeof setTimeout> | null = null
  private processedFiles: Set<string> = new Set()
  private watchFolder: string = ''
  private libraryID: number | null = null
  private processedFilesPath: string = ''
  private isScanning: boolean = false

  constructor() {
    this.watchFolder = Zotero.Prefs.get('extensions.folder-import.watchFolder') || ''
    this.libraryID = Zotero.Prefs.get('extensions.folder-import.watchLibraryID') || null
    this.updateProcessedFilesPath()
    this.loadProcessedFiles()
  }

  private updateProcessedFilesPath() {
    this.processedFilesPath = this.watchFolder ? PathUtils.join(this.watchFolder, '.zotero-folder-import-processed.json') : ''
  }

  private normalizePath(path: string): string {
    if (!path) return path
    return path.replace(/\/+$/, '')
  }

  private loadProcessedFiles() {
    this.processedFiles.clear()

    // First try to load from file
    if (this.processedFilesPath) {
      try {
        const content = Zotero.File.getContents(this.processedFilesPath)
        if (content) {
          const arr = JSON.parse(content)
          arr.forEach((p: string) => this.processedFiles.add(this.normalizePath(p)))
          log.info(`Loaded ${this.processedFiles.size} processed files from file`)
          return
        }
      }
      catch (err) {
        log.debug(`Failed to load from file: ${err}`)
      }
    }

    // Fallback to Zotero prefs
    try {
      const stored = Zotero.Prefs.get('extensions.folder-import.processedFiles')
      if (stored) {
        const arr = JSON.parse(stored as string)
        arr.forEach((p: string) => this.processedFiles.add(this.normalizePath(p)))
        log.info(`Loaded ${this.processedFiles.size} processed files from prefs`)
      }
    }
    catch (err) {
      log.debug(`Failed to load from prefs: ${err}`)
    }
  }

  private saveProcessedFiles() {
    // Save to file
    if (this.processedFilesPath) {
      try {
        Zotero.File.putContents(this.processedFilesPath, JSON.stringify([...this.processedFiles]))
        log.debug(`Saved ${this.processedFiles.size} processed files to file`)
      }
      catch (err) {
        log.error(`Failed to save to file: ${err}`)
      }
    }

    // Also save to prefs as backup
    try {
      Zotero.Prefs.set('extensions.folder-import.processedFiles', JSON.stringify([...this.processedFiles]))
    }
    catch (err) {
      log.error(`Failed to save to prefs: ${err}`)
    }
  }

  private addProcessedFile(filePath: string) {
    this.processedFiles.add(this.normalizePath(filePath))
    this.saveProcessedFiles()
  }

  public clearProcessedFiles() {
    this.processedFiles.clear()
    this.saveProcessedFiles()

    if (this.processedFilesPath) {
      try {
        const file = Zotero.File.pathToFile(this.processedFilesPath)
        if (file.exists()) {
          file.remove()
        }
        log.info('Cleared processed files and deleted tracking file')
      }
      catch (err) {
        log.error(`Failed to delete tracking file: ${err}`)
      }
    }
  }

  public getWatchFolder(): string {
    return this.watchFolder
  }

  public setWatchFolder(folder: string) {
    this.watchFolder = folder
    this.updateProcessedFilesPath()
    Zotero.Prefs.set('extensions.folder-import.watchFolder', folder)
    this.loadProcessedFiles()
    log.info(`Watch folder set to: ${folder}, loaded ${this.processedFiles.size} processed files`)
  }

  public setLibraryID(libraryID: number) {
    this.libraryID = libraryID
    Zotero.Prefs.set('extensions.folder-import.watchLibraryID', libraryID)
  }

  public getLibraryID(): number | null {
    return this.libraryID
  }

  public isWatching(): boolean {
    return this.intervalId !== null
  }

  public async scanAndImportNewFiles() {
    if (this.isScanning) {
      log.debug('Scan already in progress, skipping')
      return
    }

    if (!this.watchFolder || !await IOUtils.exists(this.watchFolder)) {
      log.debug(`Watch folder does not exist or not set: ${this.watchFolder}`)
      return
    }

    this.isScanning = true

    try {
      log.info(`Scanning watch folder: ${this.watchFolder}`)
      const root = new FolderScanner(this.watchFolder, true)
      await root.scan()

      if (!root.extensions.size) {
        log.debug('No files found in watch folder')
        return
      }

      const params = {
        link: false,
        extensions: root.extensions,
        libraryID: this.libraryID,
        progress: { update: () => {} },
      }

      const pdfs: any[] = []
      const newFiles: string[] = []

      log.info(`Total files in folder: ${root.files.length}, processed files: ${this.processedFiles.size}`)

      root.files.forEach(file => {
        const normalizedFile = this.normalizePath(file)
        const isProcessed = this.processedFiles.has(normalizedFile)
        log.debug(`Checking file: ${file}, normalized: ${normalizedFile}, isProcessed: ${isProcessed}`)
        if (!isProcessed && file.toLowerCase().endsWith('.pdf')) {
          newFiles.push(normalizedFile)
        }
      })

      if (newFiles.length === 0) {
        log.debug('No new files to import')
        return
      }

      log.info(`Found ${newFiles.length} new files to import`)

      for (const normalizedFile of newFiles.sort()) {
        try {
          log.info(`Importing new file: ${normalizedFile}`)
          const item = await Zotero.Attachments.importFromFile({
            file: normalizedFile,
            libraryID: this.libraryID!,
            collections: undefined,
          })
          if (normalizedFile.toLowerCase().endsWith('.pdf')) {
            pdfs.push(item)
          }
          this.addProcessedFile(normalizedFile)
        }
        catch (err) {
          log.error(`Failed to import ${normalizedFile}: ${err}`)
        }
        await sleep(10)
      }

      if (pdfs.length > 0) {
        log.info(`Recognizing metadata for ${pdfs.length} PDFs`)
        Zotero.RecognizeDocument.autoRecognizeItems(pdfs)
      }
    }
    finally {
      this.isScanning = false
    }
  }

  public startWatching(intervalMs: number = 5000) {
    if (this.intervalId !== null) {
      log.info('Already watching, restart with new interval')
      this.stopWatching()
    }

    if (!this.watchFolder) {
      log.info('Cannot start watching: no watch folder set')
      return false
    }

    log.info(`Starting PDF watcher on ${this.watchFolder} with interval ${intervalMs}ms`)

    const checkInterval = () => {
      if (this.intervalId !== null) {
        this.scanAndImportNewFiles()
        this.intervalId = setTimeout(checkInterval, intervalMs)
      }
    }

    this.intervalId = setTimeout(checkInterval, intervalMs)
    Zotero.Prefs.set('extensions.folder-import.watchEnabled', true)
    Zotero.Prefs.set('extensions.folder-import.watchInterval', intervalMs)

    return true
  }

  public stopWatching() {
    if (this.intervalId !== null) {
      log.info('Stopping PDF watcher')
      clearTimeout(this.intervalId)
      this.intervalId = null
      Zotero.Prefs.set('extensions.folder-import.watchEnabled', false)
    }
  }

  public getProcessedFilesCount(): number {
    return this.processedFiles.size
  }
}

export class $FolderImport {
  private status: { total: number; done: number }
  private watcher: PDFWatcher

  public async startup() {
    await Zotero.initializationPromise
    DebugLogSender.register('Folder import', [])
    this.watcher = new PDFWatcher()

    for (const win of Zotero.getMainWindows()) {
      if (win.ZoteroPane) this.onMainWindowLoad(win)
    }

    const watchEnabled = Zotero.Prefs.get('extensions.folder-import.watchEnabled')
    if (watchEnabled) {
      const watchFolder = Zotero.Prefs.get('extensions.folder-import.watchFolder')
      const watchInterval = Zotero.Prefs.get('extensions.folder-import.watchInterval') || 5000
      if (watchFolder) {
        this.watcher.setWatchFolder(watchFolder as string)
        this.watcher.startWatching(watchInterval as number)
      }
    }
  }

  public async shutdown() {
    this.watcher?.stopWatching()
    for (const win of Zotero.getMainWindows()) {
      if (win.ZoteroPane) this.onMainWindowUnload(win)
    }
  }

  public onMainWindowLoad(win: Window) {
    log.debug('onMainWindowLoad')

    ztoolkit.Menu.register('menuTools', {
      tag: 'menu',
      label: 'PDF Watch',
      children: [
        {
          tag: 'menuitem',
          label: 'Import from Folder…',
          oncommand: 'Zotero.FolderImport.addAttachmentsFromFolder()',
        },
        {
          tag: 'menuseparator',
        },
        {
          tag: 'menuitem',
          label: 'Start',
          oncommand: 'Zotero.FolderImport.startWatching()',
        },
        {
          tag: 'menuitem',
          label: 'Stop',
          oncommand: 'Zotero.FolderImport.stopWatching()',
        },
        {
          tag: 'menuseparator',
        },
        {
          tag: 'menuitem',
          label: 'Set Folder…',
          oncommand: 'Zotero.FolderImport.setWatchFolder()',
        },
        {
          tag: 'menuitem',
          label: 'Status',
          oncommand: 'Zotero.FolderImport.showWatchStatus()',
        },
        {
          tag: 'menuitem',
          label: 'Clear History',
          oncommand: 'Zotero.FolderImport.clearHistory()',
        },
      ],
    })
  }

  public onMainWindowUnload(win: Window) {
    ztoolkit.Menu.unregisterAll()
  }

  public update() {
    this.status.done += 1
    const total = `${this.status.total}`
    const done = `${this.status.done}`.padStart(total.length)
    const msg = `Imported ${done}/${total}...`
    log.debug(msg)
    Zotero.updateZoteroPaneProgressMeter(Math.min((this.status.done * 100) / this.status.total, 100))
  }

  public startWatching() {
    const folder = this.watcher.getWatchFolder()
    if (!folder) {
      Services.prompt.alert(null, 'No Watch Folder', 'Please set a watch folder first using "PDF Watch: Set Folder…"')
      return
    }

    const interval = Zotero.Prefs.get('extensions.folder-import.watchInterval') || 5000
    this.watcher.setLibraryID(Zotero.Libraries.userLibraryID)
    this.watcher.startWatching(interval as number)
    Services.prompt.alert(null, 'PDF Watch Started', `Watching folder: ${folder}\nInterval: ${interval}ms`)
  }

  public stopWatching() {
    this.watcher.stopWatching()
    Services.prompt.alert(null, 'PDF Watch Stopped', 'PDF watching has been stopped')
  }

  public async setWatchFolder() {
    const folder = await (new FilePickerHelper('Select Watch Folder', 'folder')).open()
    if (!folder) return

    this.watcher.setWatchFolder(folder)
    this.watcher.setLibraryID(Zotero.Libraries.userLibraryID)
    Services.prompt.alert(null, 'Watch Folder Set', `Now watching: ${folder}`)
  }

  public showWatchStatus() {
    const folder = this.watcher.getWatchFolder()
    const isWatching = this.watcher.isWatching()
    const processedCount = this.watcher.getProcessedFilesCount()

    const status = isWatching ? 'Running' : 'Stopped'
    const msg = `Status: ${status}\nFolder: ${folder || 'Not set'}\nProcessed files: ${processedCount}`

    Services.prompt.alert(null, 'PDF Watch Status', msg)
  }

  public clearHistory() {
    this.watcher.clearProcessedFiles()
    Services.prompt.alert(null, 'History Cleared', 'Processed files history has been cleared.\nPDF Watch will re-import all files in the watch folder on next scan.')
  }

  public async getWatchStatus(): Promise<{ folder: string; isWatching: boolean; processedCount: number }> {
    return {
      folder: this.watcher.getWatchFolder(),
      isWatching: this.watcher.isWatching(),
      processedCount: this.watcher.getProcessedFilesCount(),
    }
  }

  private async duplicates(path: string): Promise<string[]> {
    const rmlint: string = Zotero.Prefs.get('extensions.folder-import.rmlint')
    if (!rmlint) return []
    if (!await IOUtils.exists(rmlint)) return []

    const duplicates: string = PathUtils.join(Zotero.getTempDirectory().path as string, `rmlint${Zotero.Utilities.randomString()}.json`)

    try {
      const cmd = Zotero.File.pathToFile(rmlint)
      if (!cmd.isExecutable()) return []

      const proc = Components.classes['@mozilla.org/process/util;1'].createInstance(Components.interfaces.nsIProcess)
      proc.init(cmd)
      proc.startHidden = true
      const args = ['-o', `json:${duplicates}`, '-T', 'df', Zotero.getStorageDirectory(), path]
      await new Promise((resolve, reject) => {
        proc.runwAsync(args, args.length, {
          observe: (subject, topic) => {
            if (topic !== 'process-finished') {
              reject(new Error(`failed: ${rmlint} ${args}`))
            }
            else if (proc.exitValue > 0) {
              reject(new Error(`failed with exit status ${proc.exitValue}: ${rmlint} ${args}`))
            }
            else {
              resolve(true)
            }
          },
        })
      })

      return JSON.parse(Zotero.File.getContents(duplicates) as string)
        .filter((d: any) => d.type === 'duplicate_file')
        .map((d: any) => d.path as string) as string[]
    }
    catch (err) {
      log.debug(`duplicates: ${err}`)
      return []
    }
    finally {
      try {
        await IOUtils.remove(duplicates)
      }
      catch (err) {
      }
    }
  }

  public async addAttachmentsFromFolder() {
    log.debug('addAttachmentsFromFolder')
    await Zotero.Schema.schemaUpdatePromise
    const zoteroPane = Zotero.getActiveZoteroPane()

    if (!zoteroPane.canEdit()) {
      zoteroPane.displayCannotEditLibraryMessage()
      return
    }
    if (!zoteroPane.canEditFiles()) {
      zoteroPane.displayCannotEditLibraryFilesMessage()
      return
    }
    const collection = zoteroPane.getSelectedCollection()

    log.debug('opening file picker')
    const folder = await (new FilePickerHelper(`${Zotero.getString('fileInterface.import')} Folder`, 'folder')).open()
    if (!folder) return

    Zotero.showZoteroPaneProgressMeter('Scanning for attachments...')
    const root = new FolderScanner(folder, true)
    await root.scan()
    Zotero.hideZoteroPaneOverlays()

    // Zotero.Translators.getAllForType('import')

    log.debug(`scan complete: ${JSON.stringify(Array.from(root.extensions))} (${root.extensions.size})`)
    if (root.extensions.size) {
      const collectionTreeRow = zoteroPane.getCollectionTreeRow()
      const params = {
        link: false,
        extensions: root.extensions,
        libraryID: collectionTreeRow.ref.libraryID,
        progress: this,
      }

      log.debug('selected:', Array.from(params.extensions))

      if (params.extensions.size) {
        const pdfs = []
        Zotero.showZoteroPaneProgressMeter('Importing attachments...', true)
        this.status = { total: root.selected(params.extensions), done: 0 }
        await root.import(params, zoteroPane.getSelectedCollection(), pdfs, new Set(await this.duplicates(folder)))
        Zotero.hideZoteroPaneOverlays()
        if (pdfs.length) {
          Zotero.showZoteroPaneProgressMeter('Fetching metadata for attachments...')
          Zotero.RecognizeDocument.autoRecognizeItems(pdfs)
          Zotero.hideZoteroPaneOverlays()
        }
      }
    }
  }
}

export var FolderImport = Zotero.FolderImport = new $FolderImport()
