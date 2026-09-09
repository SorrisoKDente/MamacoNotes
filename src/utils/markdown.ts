/**
 * ponytail: extremely lightweight markdown renderer for release notes.
 * Converts basic markdown (headers, bold, lists, links) into HTML.
 */
export function renderMarkdown(md: string): string {
  if (!md) return ''

  // 1. Initial cleanup and escaping
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // 2. Headers (###, ##, #) - Multi-line
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>')
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>')
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>')

  // 3. Bold (**text**)
  html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')

  // 4. Italic (*text*)
  html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>')

  // 5. Lists (- or *)
  // Convert lines starting with - or * into <li>
  html = html.replace(/^\s*[-*+]\s+(.*$)/gim, '<li>$1</li>')

  // Wrap groups of <li> into <ul>
  // This regex finds consecutive <li> elements and wraps them once
  html = html.replace(/(<li>.*<\/li>(?:\s*<li>.*<\/li>)*)/gim, '<ul>$1</ul>')

  // 6. Links [text](url)
  html = html.replace(/\[(.*?)\]\((.*?)\)/gim, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

  // 7. Inline Code (`code`)
  html = html.replace(/`(.*?)`/gim, '<code>$1</code>')

  // 8. Newlines to <br/>
  // We do this at the end, but we need to avoid putting <br/> inside or immediately after block elements
  html = html.replace(/\n/gim, '<br />')

  // Cleanup: Remove <br /> that are redundant after block tags
  html = html.replace(/<\/h[1-3]><br \/>/gim, (m) => m.replace('<br />', ''))
  html = html.replace(/<\/ul><br \/>/gim, (m) => m.replace('<br />', ''))
  html = html.replace(/<li>(.*?)<br \/>/gim, '<li>$1')
  html = html.replace(/<br \/><br \/>/gim, '<br />') // collapse double br

  return html
}
