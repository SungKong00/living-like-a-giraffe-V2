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
export async function blender(mode, source, dir, input) {
  fs.mkdirSync(dir, { recursive: true })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'riragi-job-'))
  try {
    if (process.platform !== 'darwin')
      throw Error('현재 Blender 작업 격리는 macOS를 지원합니다.')
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
    const args = [worker, mode, source, dir]
    if (input) args.push(input)
    const running = exec(
      '/usr/bin/sandbox-exec',
      ['-p', policy, python, ...args],
      {
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
