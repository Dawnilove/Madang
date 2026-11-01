/** Desktop and orca serve share the app’s platform recognizer addon; madangd slots omit the ~70 MB package. */

/** Set by `orca serve` for madangd: the directory of the app's recognizer package. */
export const SPEECH_RECOGNIZER_DIR_ENV = 'MADANG_SPEECH_RECOGNIZER_DIR'

export function speechRecognizerPackageName(platform: string, arch: string): string {
  return platform === 'win32' && arch === 'x64'
    ? 'sherpa-onnx-win-x64'
    : `sherpa-onnx-${platform}-${arch}`
}
