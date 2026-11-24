import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'giraffe-package-'))
const dir = path.join(temp, 'payload'),
  lib = path.join(dir, 'lib')
const downloads = path.resolve(process.argv[2] || 'dist', 'downloads')
const dest = path.join(downloads, 'giraffe-publisher-mac.zip')
try {
  for (const folder of ['server', 'world', 'shared', 'helper'])
    fs.mkdirSync(path.join(lib, folder), { recursive: true })
  for (const name of fs
    .readdirSync('world')
    .filter(
      (n) =>
        n.endsWith('.py') ||
        ['optimize.mjs', 'instances.mjs', 'requirements.txt'].includes(n),
    ))
    fs.copyFileSync('world/' + name, path.join(lib, 'world', name))
  for (const name of [
    'render-visitor.mjs',
    'render-editor.mjs',
    'blend-handoff.mjs',
    'blender.mjs',
  ])
    fs.copyFileSync('server/' + name, path.join(lib, 'server', name))
  for (const name of ['publish.mjs', 'bridge.mjs', 'connect.mjs'])
    fs.copyFileSync('helper/' + name, path.join(lib, 'helper', name))
  fs.copyFileSync(
    'shared/helper-connection.mjs',
    path.join(lib, 'shared/helper-connection.mjs'),
  )
  const { dependencies } = JSON.parse(fs.readFileSync('package.json'))
  const required = Object.fromEntries(
    Object.entries(dependencies).filter(
      ([name]) =>
        name.startsWith('@gltf-transform/') ||
        ['meshoptimizer', 'sharp', 'gltf-validator', 'gl-matrix'].includes(
          name,
        ),
    ),
  )
  fs.writeFileSync(
    path.join(lib, 'package.json'),
    JSON.stringify({
      name: 'giraffe-publisher',
      private: true,
      type: 'module',
      dependencies: required,
    }),
  )
  fs.copyFileSync('package-lock.json', path.join(lib, 'package-lock.json'))
  execFileSync(
    'npm',
    [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--offline',
      '--no-audit',
      '--no-fund',
    ],
    { cwd: lib },
  )
  const hash = createHash('sha256')
  for (const name of fs.readdirSync(dir, { recursive: true }).sort()) {
    const file = path.join(dir, name)
    if (fs.statSync(file).isFile())
      hash.update(name).update(fs.readFileSync(file))
  }
  fs.writeFileSync(path.join(lib, 'BUILD'), hash.digest('hex').slice(0, 20))
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const app = path.join(temp, 'Giraffe Studio.app')
  execFileSync('osacompile', ['-o', app, 'helper/launcher.applescript'])
  const plist = path.join(app, 'Contents/Info.plist')
  const set = (key, flag, value) =>
    execFileSync('plutil', ['-replace', key, flag, value, plist])
  set('CFBundleIdentifier', '-string', 'dev.living-like-a-giraffe.studio')
  set(
    'CFBundleURLTypes',
    '-json',
    JSON.stringify([
      {
        CFBundleURLName: 'Giraffe Studio',
        CFBundleURLSchemes: ['giraffe-studio'],
      },
    ]),
  )
  const resources = path.join(app, 'Contents/Resources')
  fs.cpSync(lib, path.join(resources, 'lib'), { recursive: true })
  for (const [source, name] of [
    ['install-mac.sh', 'install.sh'],
    ['runtime-mac.sh', 'runtime.sh'],
    ['login-mac.sh', 'login.sh'],
  ]) {
    fs.copyFileSync('helper/' + source, path.join(resources, name))
    fs.chmodSync(path.join(resources, name), 0o755)
  }
  execFileSync('codesign', ['--force', '--sign', '-', app])
  fs.rmSync(dest, { force: true })
  execFileSync('ditto', ['-c', '-k', '--keepParent', '--norsrc', app, dest])

  const win = path.join(temp, 'windows')
  fs.cpSync('helper/windows', win, { recursive: true })
  execFileSync('zip', ['-qr', path.join(win, 'lib.zip'), '.'], { cwd: lib })
  execFileSync(
    process.env.GO_BINARY || 'go',
    [
      'build',
      '-mod=readonly',
      '-trimpath',
      '-ldflags=-s -w -H=windowsgui',
      '-o',
      path.join(downloads, 'giraffe-publisher-windows.exe'),
      '.',
    ],
    {
      cwd: win,
      env: {
        ...process.env,
        GOOS: 'windows',
        GOARCH: 'amd64',
        CGO_ENABLED: '0',
      },
      stdio: 'inherit',
    },
  )
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}
