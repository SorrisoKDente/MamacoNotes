export interface UploadStartOptions {
  sessionId: string
  url: string
  headers: Record<string, string>
}

export interface PickDirectoryPlugin {
  pick: () => Promise<{ path: string }>
  writeChunk: (options: { uri: string; filename: string; content: string; append: boolean }) => Promise<void>
  readChunk: (options: { uri: string; filename: string; offset: number; length: number }) => Promise<{ data: string; end: boolean }>
  getFileInfo: (options: { uri: string; filename: string }) => Promise<{ size: number }>
  openFilePicker: () => Promise<{ uri: string }>
  readUriChunk: (options: { uri: string; offset: number; length: number }) => Promise<{ data: string; end: boolean }>
  getUriFileInfo: (options: { uri: string }) => Promise<{ size: number }>
  uploadStart: (options: UploadStartOptions) => Promise<void>
  uploadChunk: (options: { sessionId: string; content: string }) => Promise<void>
  uploadEnd: (options: { sessionId: string }) => Promise<{ status: number; bytesWritten: number }>
}
