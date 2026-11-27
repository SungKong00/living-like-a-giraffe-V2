import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

test(
  'Mac helper launches its bundled interpreter and worker from another checkout',
  {
    skip: process.platform !== 'darwin',
  },
  async (t) => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-launch-'))
    t.after(() => fs.rm(tmp, { recursive: true, force: true }))
    const installed = path.join(tmp, 'installed helper')
    const checkout = path.join(tmp, 'older checkout')
    for (const dir of [installed, checkout]) {
      await fs.mkdir(path.join(dir, '.venv/bin'), { recursive: true })
      await fs.mkdir(path.join(dir, 'world'))
    }
    await fs.mkdir(path.join(installed, 'server'))
    const launcher = path.join(installed, 'server/blender.mjs')
    await fs.copyFile(
      new URL('../server/blender.mjs', import.meta.url),
      launcher,
    )
    // Use a tiny shell worker to exercise the real sandbox launcher without bpy.
    await fs.writeFile(
      path.join(installed, '.venv/bin/python'),
      '#!/bin/sh\nexec /bin/sh "$@"\n',
      { mode: 0o755 },
    )
    await fs.writeFile(
      path.join(installed, 'world/worker.py'),
      'cat "$2" > "$3/result"\n',
    )
    await fs.writeFile(
      path.join(checkout, '.venv/bin/python'),
      '#!/bin/sh\nexit 9\n',
      { mode: 0o755 },
    )
    await fs.writeFile(path.join(checkout, 'world/worker.py'), 'exit 8\n')
    await fs.writeFile(
      path.join(checkout, 'source.blend'),
      'bundled worker ran',
    )
    await promisify(execFile)(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import { blender } from ${JSON.stringify(pathToFileURL(launcher).href)};
     await blender('studio', 'source.blend', 'output')`,
      ],
      { cwd: checkout },
    )
    assert.equal(
      await fs.readFile(path.join(checkout, 'output/result'), 'utf8'),
      'bundled worker ran',
    )
  },
)
