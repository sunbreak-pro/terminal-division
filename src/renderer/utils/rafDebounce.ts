/**
 * requestAnimationFrameを使用したデバウンス関数
 * リサイズなどの連続したイベントをアニメーションフレームに合わせて最適化
 */
export function rafDebounce<T extends (...args: unknown[]) => void>(fn: T): T {
  let rafId: number | null = null

  return ((...args: unknown[]) => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
    }
    rafId = requestAnimationFrame(() => {
      rafId = null
      fn(...args)
    })
  }) as T
}

/**
 * requestAnimationFrame + 追加の遅延を組み合わせたデバウンス
 * 連続した高頻度のリサイズイベントをバッチ処理
 */
export function rafDebounceWithDelay<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): { handler: T; cancel: () => void } {
  let rafId: number | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const handler = ((...args: unknown[]) => {
    // 既存のリクエストをキャンセル
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }

    // 遅延後にrAFを使用して実行
    timeoutId = setTimeout(() => {
      timeoutId = null
      rafId = requestAnimationFrame(() => {
        rafId = null
        fn(...args)
      })
    }, delay)
  }) as T

  const cancel = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return { handler, cancel }
}
