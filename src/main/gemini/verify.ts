/**
 * Hậu kiểm câu trả lời của Gemini: mọi nước đi dạng SAN xuất hiện trong văn bản phải nằm trong
 * tập nước đã cung cấp (nước đã đi, nước tốt nhất, các biến engine).
 *
 * Chỉ kiểm tra các token chắc chắn là nước đi: nước quân (Nf3, Bxe5, Rad1), nước ăn của tốt (exd5),
 * phong cấp (e8=Q) và nhập thành. Nước tốt đơn thuần ("e4") trùng với tên ô nên không kiểm tra.
 */
const SAN_RE = /(?<![A-Za-z0-9])(O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][18]=[QRBN])[+#]?(?![A-Za-z0-9])/g

export const stripSan = (san: string): string => san.replace(/[+#!?]/g, '')

export function extractSans(text: string): string[] {
  return [...text.matchAll(SAN_RE)].map((m) => stripSan(m[1]!))
}

function collectStrings(v: unknown, out: string[]): void {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collectStrings(x, out))
}

/** Trả về danh sách nước "lạ" (không có trong dữ liệu), đã bỏ trùng. */
export function findUnknownMoves(data: unknown, allowed: Set<string>): string[] {
  const texts: string[] = []
  collectStrings(data, texts)
  const allowedStripped = new Set([...allowed].map(stripSan))
  const bad = new Set<string>()
  for (const t of texts) for (const san of extractSans(t)) if (!allowedStripped.has(san)) bad.add(san)
  return [...bad]
}
