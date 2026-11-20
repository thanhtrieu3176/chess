import type { DetailedHTMLProps, HTMLAttributes } from 'react'
import type { WindowApi } from '@shared/api'

declare global {
  interface Window {
    api: WindowApi
  }
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      /** Phần tử quân cờ của chessground (dùng trong hộp chọn phong cấp). */
      piece: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>
    }
  }
}
