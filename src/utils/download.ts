/**
 * ponytail: centralized browser download helper.
 */
export function triggerDownload(content: Blob | string, filename: string) {
  const isBlob = content instanceof Blob
  const url = isBlob ? URL.createObjectURL(content) : content
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  if (isBlob) {
    // Grace period for the browser to start the download before revoking
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }
}
