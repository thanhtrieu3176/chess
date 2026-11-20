/** Đọc JSON đang stream dở: đóng tạm các chuỗi/ngoặc còn mở để hiển thị từng phần. */
export function parsePartialJson(text: string): Record<string, unknown> | null {
  const stack: string[] = []
  let inStr = false
  let esc = false
  for (const ch of text) {
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') stack.pop()
  }
  let fixed = text.replace(/\\$/, '')
  if (inStr) fixed += '"'
  fixed = fixed.replace(/,\s*$/, '').replace(/:\s*$/, ': null')
  fixed += stack.reverse().join('')
  try {
    return JSON.parse(fixed) as Record<string, unknown>
  } catch {
    return null
  }
}
