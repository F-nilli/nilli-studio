'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { parseDate } from '@/lib/utils'

interface EpisodeImage {
  id: string
  episode_id: string
  url: string
  filename: string | null
  uploaded_by: string | null
  created_at: string
}

interface Props {
  episodeId: string
  canManage: boolean
  currentUserId: string
}

function isPdf(item: EpisodeImage): boolean {
  return item.filename?.toLowerCase().endsWith('.pdf') ?? false
}

export function EpisodeImages({ episodeId, canManage, currentUserId }: Props) {
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<EpisodeImage[]>([])
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<EpisodeImage | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [sizeWarning, setSizeWarning] = useState('')

  const imageItems = items.filter(item => !isPdf(item))

  async function loadItems() {
    const { data } = await supabase
      .from('episode_images')
      .select('*')
      .eq('episode_id', episodeId)
      .order('created_at', { ascending: true })
    setItems(data || [])
  }

  useEffect(() => {
    loadItems()
  }, [episodeId])

  async function handleAddFiles(files: File[]) {
    if (!files.length) return
    const MAX_MB = 10
    const tooBig = files.filter(f => f.size > MAX_MB * 1024 * 1024)
    const valid = files.filter(f => f.size <= MAX_MB * 1024 * 1024)
    if (tooBig.length > 0) {
      const names = tooBig.map(f => f.name).join(', ')
      const noun = tooBig.length === 1 ? `"${names}" is` : `${tooBig.length} files are`
      setSizeWarning(`${noun} too large (max 10MB each) and were not uploaded`)
      setTimeout(() => setSizeWarning(''), 5000)
    } else {
      setSizeWarning('')
    }
    if (!valid.length) return
    setUploading(true)
    for (const file of valid) {
      const path = `${episodeId}/${Date.now()}-${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('episode-references')
        .upload(path, file)
      if (uploadError) continue
      const { data: urlData } = supabase.storage
        .from('episode-references')
        .getPublicUrl(path)
      await supabase.from('episode_images').insert({
        episode_id: episodeId,
        url: urlData.publicUrl,
        filename: file.name,
        uploaded_by: currentUserId,
      })
    }
    setUploading(false)
    await loadItems()
  }

  async function handleDelete(item: EpisodeImage) {
    setDeleting(true)
    const storagePath = item.url.split('/episode-references/')[1]
    if (storagePath) await supabase.storage.from('episode-references').remove([storagePath])
    await supabase.from('episode_images').delete().eq('id', item.id)
    const newItems = items.filter(i => i.id !== item.id)
    setItems(newItems)
    if (lightboxIndex !== null && !isPdf(item)) {
      const newImageItems = newItems.filter(i => !isPdf(i))
      if (newImageItems.length === 0) setLightboxIndex(null)
      else setLightboxIndex(Math.min(lightboxIndex, newImageItems.length - 1))
    }
    setDeleteTarget(null)
    setDeleting(false)
  }

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (lightboxIndex === null) return
    if (e.key === 'ArrowRight') setLightboxIndex(i => i !== null ? Math.min(i + 1, imageItems.length - 1) : null)
    if (e.key === 'ArrowLeft') setLightboxIndex(i => i !== null ? Math.max(i - 1, 0) : null)
    if (e.key === 'Escape') setLightboxIndex(null)
  }, [lightboxIndex, imageItems.length])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [handleKey])

  if (items.length === 0 && !canManage) return null

  const currentImage = lightboxIndex !== null ? imageItems[lightboxIndex] : null

  return (
    <>
      {sizeWarning && (
        <p className="text-xs text-amber-400 mt-2">{sizeWarning}</p>
      )}

      {(items.length > 0 || canManage) && (
        <div className="flex items-center gap-2 overflow-x-auto mt-3" style={{ scrollbarWidth: 'none' }}>
          {items.map(item => (
            isPdf(item) ? (
              <PdfCard
                key={item.id}
                item={item}
                canManage={canManage}
                onDelete={() => setDeleteTarget(item)}
              />
            ) : (
              <button
                key={item.id}
                onClick={() => setLightboxIndex(imageItems.indexOf(item))}
                className="shrink-0 relative group/thumb"
                style={{ width: 120, height: 80, borderRadius: 6, overflow: 'hidden', display: 'block' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.url}
                  alt={item.filename || 'Reference'}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'filter 150ms' }}
                  className="group-hover/thumb:brightness-110"
                />
                <div
                  className="absolute inset-0 opacity-0 group-hover/thumb:opacity-100 transition-opacity pointer-events-none"
                  style={{ border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6 }}
                />
              </button>
            )
          ))}

          {canManage && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                multiple
                className="hidden"
                onChange={e => {
                  const files = Array.from(e.target.files || [])
                  if (files.length) handleAddFiles(files)
                  e.target.value = ''
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="shrink-0 text-xs font-semibold text-[#555] hover:text-[#888] disabled:opacity-40 transition-colors whitespace-nowrap pl-1"
              >
                {uploading ? 'Uploading…' : '+ Add files'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Lightbox — images only */}
      {currentImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.93)' }}
          onClick={() => setLightboxIndex(null)}
        >
          <button
            onClick={() => setLightboxIndex(null)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center text-[#888] hover:text-white hover:bg-white/10 transition-colors text-2xl leading-none"
          >
            ×
          </button>

          {lightboxIndex !== null && lightboxIndex > 0 && (
            <button
              onClick={e => { e.stopPropagation(); setLightboxIndex(lightboxIndex - 1) }}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center text-white text-xl bg-black/50 hover:bg-black/70 transition-colors"
            >
              ←
            </button>
          )}

          <div
            className="flex flex-col items-center"
            style={{ maxWidth: '90vw', maxHeight: '90vh' }}
            onClick={e => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentImage.url}
              alt={currentImage.filename || 'Reference'}
              style={{ maxWidth: '90vw', maxHeight: '75vh', objectFit: 'contain', borderRadius: 8 }}
            />
            <div className="mt-3 text-center">
              {currentImage.filename && (
                <p className="text-sm text-[#888]">{currentImage.filename}</p>
              )}
              <p className="text-xs text-[#555] mt-0.5">
                {format(parseDate(currentImage.created_at), 'MMM d, yyyy')}
              </p>
            </div>
            {canManage && (
              <button
                onClick={() => setDeleteTarget(currentImage)}
                className="mt-2 text-xs text-[#555] hover:text-[#ff3c00] transition-colors"
              >
                Delete
              </button>
            )}
          </div>

          {lightboxIndex !== null && lightboxIndex < imageItems.length - 1 && (
            <button
              onClick={e => { e.stopPropagation(); setLightboxIndex(lightboxIndex + 1) }}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center text-white text-xl bg-black/50 hover:bg-black/70 transition-colors"
            >
              →
            </button>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setDeleteTarget(null)} />
          <div className="relative w-full max-w-xs rounded-xl p-5 space-y-4" style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)' }}>
            <p className="text-sm font-semibold text-white">
              Remove this {isPdf(deleteTarget) ? 'PDF' : 'reference image'}?
            </p>
            {deleteTarget.filename && (
              <p className="text-xs text-[#666]">{deleteTarget.filename}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm text-[#888] hover:text-white border border-[#2e2e2e] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-semibold bg-[#dc2626] hover:bg-[#b91c1c] disabled:opacity-40 text-white rounded-lg transition-colors"
              >
                {deleting ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── PDF thumbnail card ────────────────────────────────────────────────────────

function PdfCard({ item, canManage, onDelete }: {
  item: EpisodeImage
  canManage: boolean
  onDelete: () => void
}) {
  const name = item.filename ?? 'document.pdf'
  const displayName = name.length > 20 ? name.slice(0, 17) + '…' : name

  return (
    <div
      className="shrink-0 relative group/pdfcard flex flex-col items-center justify-between py-2.5 px-2"
      style={{
        width: 130,
        height: 90,
        borderRadius: 6,
        background: '#1e1e1e',
        border: '1px solid rgba(255,255,255,0.09)',
        flexShrink: 0,
      }}
    >
      {/* PDF icon */}
      <div
        className="flex items-center justify-center rounded-md shrink-0"
        style={{ width: 32, height: 32, background: 'rgba(255,60,0,0.12)' }}
      >
        <svg width="16" height="18" viewBox="0 0 16 18" fill="none">
          <path
            d="M2 1.5h7.5L14 6v10.5H2V1.5z"
            stroke="#ff3c00"
            strokeWidth="1.2"
            fill="rgba(255,60,0,0.15)"
            strokeLinejoin="round"
          />
          <path
            d="M9.5 1.5V6H14"
            stroke="#ff3c00"
            strokeWidth="1.2"
            fill="none"
            strokeLinejoin="round"
          />
          <text x="8" y="14.5" textAnchor="middle" fill="#ff3c00" fontSize="4.5" fontWeight="700" fontFamily="system-ui, sans-serif">
            PDF
          </text>
        </svg>
      </div>

      {/* Filename */}
      <span
        className="text-center leading-tight w-full truncate"
        style={{ fontSize: 10, color: '#777' }}
        title={name}
      >
        {displayName}
      </span>

      {/* Open link */}
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 transition-colors"
        style={{ fontSize: 10, color: '#555' }}
        onMouseEnter={e => (e.currentTarget.style.color = '#f7931a')}
        onMouseLeave={e => (e.currentTarget.style.color = '#555')}
        onClick={e => e.stopPropagation()}
      >
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
          <path d="M5 1v6M2 4.5l3 3 3-3M1 8.5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span>Open</span>
      </a>

      {/* Delete (hover, canManage only) */}
      {canManage && (
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-xs leading-none opacity-0 group-hover/pdfcard:opacity-100 transition-opacity"
          style={{ background: 'rgba(0,0,0,0.7)', color: '#666' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#ff3c00')}
          onMouseLeave={e => (e.currentTarget.style.color = '#666')}
        >
          ×
        </button>
      )}
    </div>
  )
}
