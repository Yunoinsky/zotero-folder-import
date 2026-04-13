import path from 'path'
import fs from 'fs'

import esbuild from 'esbuild'

import 'zotero-plugin/make-dirs'
import 'zotero-plugin/make-manifest'
import 'zotero-plugin/make-version'
import 'zotero-plugin/copy-assets'

async function bundle(entry) {
  const outdir = path.join('build', path.basename(path.dirname(entry)))
  const config = {
    entryPoints: [ entry ],
    outdir,
    bundle: true,
    format: 'iife',
    target: ['firefox60'],
    treeShaking: true,
    minify: false,
    drop: ['console'],
    external: [ 'zotero/itemTree' ]
  }

  const target = path.join(outdir, path.basename(entry).replace(/[.]ts$/, '.js'))
  const esm = await esbuild.build({ ...config, logLevel: 'silent', format: 'esm', metafile: true, write: false })
  const postfix = `$$${Date.now()}`
  for (const output of Object.values(esm.metafile.outputs)) {
    if (output.entryPoint) {
      config.globalName = `${escape(`{ ${output.exports.join(', ')} }`).replace(/%/g, '$')}${postfix}`
      console.log(config.globalName)
    }
  }

  await esbuild.build(config)

  await fs.promises.writeFile(
    target,
    (await fs.promises.readFile(target, 'utf-8')).replace(config.globalName, unescape(config.globalName.replace(postfix, '').replace(/[$]/g, '%')))
  )
}

async function build() {
  await bundle('bootstrap.ts')
  await bundle('content/folder-import.ts')

  fs.copyFileSync('content/prefs.js', 'build/content/prefs.js')
  fs.copyFileSync('content/preferences.xhtml', 'build/content/preferences.xhtml')
  
  const manifest = JSON.parse(fs.readFileSync('build/manifest.json', 'utf8'))
  fs.writeFileSync('build/manifest.json', JSON.stringify(manifest, null, 2))
}

build().catch(err => {
  console.log(err)
  process.exit(1)
})
