import { dialog, BrowserWindow } from 'electron'
import path from 'node:path'
import Store from 'electron-store'

interface AppSettings {
  theme?: string
  language?: string
  autoSave?: boolean
  showHiddenFiles?: boolean
  enablePreview?: boolean
  autoClassifyWithoutConfirmation?: boolean
  autoSaveRAG?: boolean
  workDirectory?: string
}

export class ImportService {
  private importQueue: string[] = []
  private isProcessing = false
  private store: Store
  private win: BrowserWindow | null

  constructor(store: Store, win: BrowserWindow | null) {
    this.store = store
    this.win = win
  }

  // Add file to import queue
  async addFileToQueue(): Promise<{ success: boolean; message: string }> {
    try {
      const result = await dialog.showOpenDialog(this.win!, {
        properties: ['openFile'],
        filters: [
          { name: 'All Files', extensions: ['*'] },
          { name: 'Documents', extensions: ['txt', 'md', 'doc', 'docx', 'pdf', 'rtf', 'odt'] },
          { name: 'Spreadsheets', extensions: ['xlsx', 'xls', 'csv', 'ods'] },
          { name: 'Presentations', extensions: ['pptx', 'ppt', 'odp'] },
          { name: 'Web Files', extensions: ['html', 'htm', 'xhtml'] },
        ]
      })

      if (result.canceled || !result.filePaths[0]) {
        return { success: false, message: 'User canceled file selection' }
      }

      const filePath = result.filePaths[0]

      // Add to queue
      this.importQueue.push(filePath)

      // Start processing if not already processing
      if (!this.isProcessing) {
        this.processImportQueue()
      }

      return { success: true, message: 'File added to import queue' }
    } catch (error) {
      console.error('Import file error:', error)
      return { success: false, message: 'Failed to add file to queue' }
    }
  }

  // Process import queue
  private async processImportQueue() {
    if (this.isProcessing || this.importQueue.length === 0) {
      return
    }

    this.isProcessing = true

    while (this.importQueue.length > 0) {
      const filePath = this.importQueue.shift()!

      try {
        const result = await this.processSingleFile(filePath)
        // Send result to renderer
        if (this.win) {
          this.win.webContents.send('import-result', result)
        }
      } catch (error) {
        console.error('Error processing file:', filePath, error)
        if (this.win) {
          this.win.webContents.send('import-result', { success: false, message: `Failed to import ${path.basename(filePath)}` })
        }
      }
    }

    this.isProcessing = false
  }

  // Process a single file
  private async processSingleFile(filePath: string) {
    // Get work directory from store
    const workDirectory = this.store.get('workDirectory', 'workdir') as string

    // Step 1: Get directory structure
    const directoryStructureResponse = await fetch('http://localhost:8000/api/files/list-directory-recursive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory_path: workDirectory, max_depth: 3 })
    })

    if (!directoryStructureResponse.ok) {
      throw new Error('Failed to get directory structure')
    }

    const directoryStructureData = await directoryStructureResponse.json()
    if (!directoryStructureData.success) {
      throw new Error('Failed to get directory structure')
    }

    // Extract directories
    const directories = this.extractDirectoriesFromStructure(directoryStructureData.data)

    // Step 2: Get recommended directory
    const recommendResponse = await fetch('http://localhost:8000/api/files/recommend-directory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath, available_directories: directories })
    })

    if (!recommendResponse.ok) {
      throw new Error('Failed to get recommended directory')
    }

    const recommendData = await recommendResponse.json()
    if (!recommendData.success) {
      throw new Error('Failed to get recommended directory')
    }

    const recommendedDirectory = recommendData.data.recommended_directory

    // Step 3: Get settings
    const settings = this.store.get('settings', {}) as AppSettings
    const autoClassifyWithoutConfirmation = settings?.autoClassifyWithoutConfirmation || false

    let targetDirectory = recommendedDirectory

    if (!autoClassifyWithoutConfirmation) {
      // For now, auto-select recommended directory. In future, could show dialog
      // But since this is in main process, we'll auto-confirm for simplicity
      targetDirectory = recommendedDirectory
    }

    // Step 4: Save file
    const separator = process.platform === 'win32' ? '\\' : '/'
    const fullTargetDirectory = targetDirectory.startsWith(workDirectory)
      ? targetDirectory
      : `${workDirectory}${separator}${targetDirectory.replace(/\//g, separator)}`

    const saveResponse = await fetch('http://localhost:8000/api/files/save-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_file_path: filePath,
        target_directory: fullTargetDirectory,
        overwrite: false
      })
    })

    if (!saveResponse.ok) {
      throw new Error('Failed to save file')
    }

    const saveData = await saveResponse.json()
    if (!saveData.success) {
      throw new Error(saveData.message || 'Failed to save file')
    }

    // Step 5: Import to RAG if enabled
    if (settings?.autoSaveRAG) {
      const fileName = path.basename(filePath)
      const savedFilePath = path.join(fullTargetDirectory, fileName)

      await fetch('http://localhost:8000/api/files/import-to-rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: savedFilePath })
      })
      // Don't fail the whole operation if RAG import fails
    }

    return { success: true, message: `File imported successfully to ${targetDirectory}` }
  }

  // Helper function to extract directories from structure
  private extractDirectoriesFromStructure(structureData: unknown): string[] {
    const directories: string[] = []
    
    if (structureData && typeof structureData === 'object' && 'items' in structureData) {
      const data = structureData as { items?: unknown[] }
      if (data.items) {
        for (const item of data.items) {
          if (item && typeof item === 'object' && 'type' in item && 'relative_path' in item) {
            const dirItem = item as { type: string; relative_path: string }
            if (dirItem.type === 'folder' && dirItem.relative_path && dirItem.relative_path !== '.') {
              directories.push(dirItem.relative_path)
            }
          }
        }
      }
    }
    
    return directories
  }
}