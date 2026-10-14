/**
 * ffmpeg for the README pictures: a 2× page → a sharp PNG at its final size, and numbered frames →
 * a looping GIF with one palette built from the whole clip (palettegen / paletteuse), storing per
 * frame only the part that changed. `FFMPEG` names the binary when it is not in a usual place.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function findFfmpeg() {
  for (const bin of [process.env.FFMPEG, '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'].filter(Boolean)) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore' })
      return bin
    } catch {
      // try the next place
    }
  }
  throw new Error('ffmpeg not found: install it (brew install ffmpeg), or set FFMPEG to its path')
}
let bin
const ffmpeg = (args) => execFileSync((bin ??= findFfmpeg()), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })

/** `src` → `out` at `width` × `height` (Lanczos; transparency kept). */
export function png(src, out, { width, height }) {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  ffmpeg(['-i', src, '-vf', `scale=${width}:${height}:flags=lanczos`, '-frames:v', '1', '-update', '1', out])
}

/**
 * `<dir>/%05d.png` at `fps` → `out`, `width` px wide, looping for ever. `colors` caps the palette.
 */
export function gif(dir, out, { fps, width, colors = 256 }) {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const filter =
    `[0:v]scale=${width}:-1:flags=lanczos,split[a][b];` +
    `[a]palettegen=max_colors=${colors}:stats_mode=diff[p];` +
    `[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`
  ffmpeg(['-framerate', String(fps), '-i', path.join(dir, '%05d.png'), '-filter_complex', filter, '-loop', '0', out])
}

/** A GIF's length in seconds: the sum of its frames' delays. */
export function gifSeconds(file) {
  const buf = fs.readFileSync(file)
  let hundredths = 0
  const marker = Buffer.from([0x21, 0xf9, 0x04])
  for (let i = buf.indexOf(marker); i !== -1; i = buf.indexOf(marker, i + 8)) hundredths += buf.readUInt16LE(i + 4)
  return hundredths / 100
}

/** `{ width, height, bytes }` of a PNG or GIF, from its header. */
export function sizeOf(file) {
  const buf = fs.readFileSync(file)
  if (buf.toString('ascii', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), bytes: buf.length }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length }
}
