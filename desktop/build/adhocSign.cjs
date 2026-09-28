// electron-builder `afterPack` hook: ad-hoc sign the packed macOS bundle.
//
// `mac.identity: null` makes electron-builder skip signing entirely, which leaves the app with
// only the linker signature Electron ships on its main binary and NO bundle seal
// (`_CodeSignature/CodeResources`). Gatekeeper reports a downloaded bundle in that state as
// "damaged and can't be opened" instead of the ordinary unidentified-developer prompt with its
// "Open Anyway". A deep ad-hoc signature (`codesign --sign -`) seals every nested binary and the
// resources, needs no certificate, and runs identically on a laptop and on the CI runner.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

module.exports = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
