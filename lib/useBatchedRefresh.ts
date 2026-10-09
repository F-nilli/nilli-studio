'use client'

import { useCallback, useEffect, useRef } from 'react'
import { createRequestBatcher } from './requestBatcher'

export function useBatchedRefresh(run: () => Promise<unknown>, scope: string | undefined) {
  const runRef = useRef(run)
  runRef.current = run
  const batcherRef = useRef<ReturnType<typeof createRequestBatcher> | null>(null)

  useEffect(() => {
    const batcher = createRequestBatcher({ run: () => runRef.current() })
    batcherRef.current = batcher
    return () => {
      batcher.dispose()
      batcherRef.current = null
    }
  }, [scope])

  return useCallback(() => batcherRef.current?.schedule(), [])
}
