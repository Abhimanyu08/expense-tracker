/* Screenshots are shrunk in the browser before upload, because the parse
 * consumer has to base64 the bytes inside a Worker isolate on a 10 ms CPU
 * budget. Measured: 45 KB costs 0.16 ms, 500 KB costs 1.91 ms, and 3.7 MB
 * costs 13.13 ms -- over the limit on the encode alone. A CPU kill does not
 * run the consumer's catch block, so it would strand the screenshot rather
 * than fail it cleanly. Cheaper to never send those bytes.
 *
 * 1280 px is not a guess: Telegram already recompresses to exactly that, and
 * those images parsed with perfect accuracy. */
const MAX_EDGE = 1280
const QUALITY = 0.85

// Matches AI_INLINE_MAX_BYTES on the server.
const SKIP_BELOW_BYTES = 512 * 1024

export type Prepared = { blob: Blob; width: number | null; height: number | null }

/** Always resolves. Falls back to the original bytes rather than losing a share. */
export async function prepareForUpload(file: Blob): Promise<Prepared> {
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(file)
    const { width: w0, height: h0 } = bitmap
    const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0))

    // Already small enough -- re-encoding would only shed quality and cost CPU.
    if (scale === 1 && file.size <= SKIP_BELOW_BYTES) {
      return { blob: file, width: w0, height: h0 }
    }

    const width = Math.max(1, Math.round(w0 * scale))
    const height = Math.max(1, Math.round(h0 * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return { blob: file, width: w0, height: h0 }
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    )
    // Re-encoding is not always a win; keep whichever is actually smaller.
    if (!blob || blob.size >= file.size) return { blob: file, width: w0, height: h0 }
    return { blob, width, height }
  } catch {
    /* HEIC in a browser that cannot decode it is the realistic failure. Upload
     * the original rather than dropping the user's screenshot -- the server
     * sniffs magic bytes and enforces its own size cap. */
    return { blob: file, width: null, height: null }
  } finally {
    bitmap?.close()
  }
}
