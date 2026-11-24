import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const python = path.resolve('.venv/bin/python')
const worker = path.resolve('world/worker.py')
const quote = (value) => JSON.stringify(fs.realpathSync(value))
const maxTime = 15 * 60 * 1000
export async function blender(mode, source, dir, input, signal, onBakePercent) {
  fs.mkdirSync(dir, { recursive: true })
  if (!onBakePercent) return runBlender(mode, source, dir, input, signal)
  // Keep reading our own file descriptor across the sandbox boundary on both OSes.
  const file = path.join(dir, 'bake.percent')
  const fd = fs.openSync(file, 'wx+', 0o600)
  const bytes = Buffer.alloc(3)
  let last = -1
  const sample = () => {
    if (fs.readSync(fd, bytes, 0, 3, 0) !== 3) return
    const value = bytes.toString('ascii')
    if (!/^\d{3}$/.test(value)) return
    const percent = Number(value)
    if (percent <= 100 && percent > last) {
      last = percent
      onBakePercent(percent)
    }
  }
  let sampleError
  const timer = setInterval(() => {
    try {
      sample()
    } catch (error) {
      sampleError = error
      clearInterval(timer)
    }
  }, 500)
  try {
    await runBlender(mode, source, dir, input, signal)
    if (sampleError) throw sampleError
    sample()
  } finally {
    clearInterval(timer)
    fs.closeSync(fd)
    fs.rmSync(file, { force: true })
  }
}

async function runBlender(mode, source, dir, input, signal) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'riragi-job-'))
  try {
    const args = [worker, mode, source, dir]
    if (input) args.push(input)
    if (process.platform === 'win32') {
      await exec(
        path.resolve('Giraffe Studio.exe'),
        ['--worker', dir, ...args],
        {
          cwd: process.cwd(),
          windowsHide: true,
          signal,
          timeout: maxTime,
        },
      )
      return
    }
    if (process.platform !== 'darwin')
      throw Error('이 운영체제에는 사용할 수 있는 Blender 도우미가 없습니다.')
    const prefix = path.dirname(path.dirname(fs.realpathSync(python)))
    const reads = [
      path.resolve('.venv'),
      prefix,
      path.dirname(worker),
      source,
      dir,
      tmp,
    ]
    const except = (paths) =>
      paths.map((p) => '(require-not (subpath ' + quote(p) + '))').join('')
    const policy =
      '(version 1)(allow default)(deny network*)' +
      '(deny file-read-data (require-all (require-any (subpath "/Users")(subpath "/Volumes")) ' +
      except(reads) +
      '))' +
      '(deny file-write* (require-all ' +
      except([dir, tmp]) +
      '(require-not (literal "/dev/null"))))'
    const running = exec(
      '/usr/bin/sandbox-exec',
      ['-p', policy, python, ...args],
      {
        signal,
        cwd: tmp,
        timeout: maxTime,
        killSignal: 'SIGKILL',
        maxBuffer: 16 * 1024 * 1024,
        env: {
          PATH: '/usr/bin:/bin',
          HOME: tmp,
          TMPDIR: tmp,
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONNOUSERSITE: '1',
        },
      },
    )
    // macOS does not enforce RLIMIT_AS. Measure the separate Blender process.
    const watch = setInterval(async () => {
      try {
        const { stdout } = await exec('/bin/ps', [
          '-o',
          'rss=',
          '-p',
          String(running.child.pid),
        ])
        if (Number(stdout.trim()) > 6 * 1024 * 1024)
          running.child.kill('SIGKILL')
      } catch {
        /* The worker has already exited. */
      }
    }, 1000)
    try {
      await running
    } finally {
      clearInterval(watch)
    }
  } catch (e) {
    signal?.throwIfAborted()
    if (process.env.RIRAGI_DEBUG) console.error(e.stderr?.slice(-6000))
    const detail =
      (e.stderr || '')
        .trim()
        .split('\n')
        .filter((line) => /Error:|오류|실패/.test(line))
        .slice(-2)
        .join(' · ') ||
      e.signal ||
      '작업자 시작 실패'
    throw Error('Blender ' + mode + ' 처리 실패 · ' + detail)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
