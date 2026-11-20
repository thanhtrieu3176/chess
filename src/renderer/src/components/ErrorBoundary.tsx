import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Tên khu vực, hiển thị trong thông báo lỗi. */
  area: string
}

/** Bắt lỗi render của từng khu vực, để một khu vực lỗi không làm trắng cả app. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  override state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="m-4 rounded border border-danger/50 bg-danger/10 p-4">
        <div className="font-semibold text-danger">Khu vực "{this.props.area}" gặp lỗi</div>
        <pre className="mt-2 text-xs whitespace-pre-wrap text-muted">{this.state.error.message}</pre>
        <button className="mt-3 rounded bg-panel-2 px-3 py-1" onClick={() => this.setState({ error: null })}>
          Thử lại
        </button>
      </div>
    )
  }
}
