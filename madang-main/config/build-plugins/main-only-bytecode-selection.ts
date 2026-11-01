import type { Plugin, Rollup } from 'vite'

type OutputChunk = Rollup.OutputChunk

/**
 * 배포 빌드 보호: V8 바이트코드로 만들 chunk를 고른다.
 *
 * 바이트코드는 Electron의 V8에서만 읽힌다. 서버·CLI·워커·프리로드 진입 파일은 일반 Node나 샌드박스에서도
 * 실행돼야 하므로 평문으로 둔다. 그래서 `index` 진입에서만 닿는 chunk만 고른다.
 * 다른 진입에서 한 번이라도 닿는 chunk는 평문이다 (안전한 쪽으로 틀린다).
 *
 * electron-vite의 `chunkAlias`는 RegExp를 받는다. 번들 그래프는 generateBundle에서야 알 수 있어서,
 * `test()`가 그때 채워진 집합을 보는 RegExp를 넘긴다. 이 플러그인의 generateBundle이
 * (enforce: 'pre') electron-vite의 바이트코드 플러그인(enforce: 'post')보다 먼저 돈다. Vite 플러그인 목록에 넣어야 한다.
 */
export function createMainOnlyBytecodeSelection(): { chunkAlias: RegExp; plugin: Plugin } {
  const selectedNames = new Set<string>()

  class SelectedChunkNames extends RegExp {
    override test(name: string): boolean {
      return selectedNames.has(name)
    }
  }

  const plugin: Plugin = {
    name: 'madang:main-only-bytecode-selection',
    apply: 'build',
    enforce: 'pre',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter(
        (item): item is OutputChunk => item.type === 'chunk'
      )
      const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
      const reach = (entry: OutputChunk): Set<string> => {
        const seen = new Set<string>()
        const stack = [entry.fileName]
        while (stack.length > 0) {
          const fileName = stack.pop() as string
          if (seen.has(fileName)) {
            continue
          }
          seen.add(fileName)
          const chunk = byFileName.get(fileName)
          if (chunk) {
            stack.push(...chunk.imports, ...chunk.dynamicImports)
          }
        }
        return seen
      }

      const indexEntry = chunks.find((chunk) => chunk.isEntry && chunk.name === 'index')
      if (!indexEntry) {
        throw new Error('[main-only-bytecode] the "index" entry chunk is missing from the bundle.')
      }
      const sharedWithOthers = new Set<string>()
      for (const chunk of chunks) {
        if (chunk.isEntry && chunk !== indexEntry) {
          for (const fileName of reach(chunk)) {
            sharedWithOthers.add(fileName)
          }
        }
      }
      const allowed = [...reach(indexEntry)].filter((fileName) => !sharedWithOthers.has(fileName))
      const allowedFiles = new Set(allowed)
      // 이름은 chunk마다 유일하지 않을 수 있다. 평문이어야 하는 chunk와 이름이 겹치면 고르지 않는다.
      const plainNames = new Set(
        chunks.filter((chunk) => !allowedFiles.has(chunk.fileName)).map((chunk) => chunk.name)
      )
      selectedNames.clear()
      for (const fileName of allowed) {
        const name = byFileName.get(fileName)?.name
        if (name && !plainNames.has(name)) {
          selectedNames.add(name)
        }
      }
      // electron-vite는 require("./x.js")를 .jsc로 바꿀 때 탐욕적인 \S* 정규식을 쓴다. 압축된 코드는 require 여러 개가
      // 공백 없이 한 줄로 이어져서, 이어진 구간마다 마지막 하나만 바뀌고 나머지는 없는 .js를 찾다 죽는다.
      // require 뒤에 공백을 넣어 구간을 끊는다 (공백은 JS 의미를 바꾸지 않는다).
      for (const chunk of chunks) {
        if (selectedNames.has(chunk.name)) {
          chunk.code = chunk.code.replace(
            /require\((["'])(\.[^"'\\]*\.js)\1\)/g,
            (_match, quote: string, path: string) => `require(${quote}${path}${quote}) `
          )
        }
      }
      if (!selectedNames.has('index')) {
        throw new Error(
          '[main-only-bytecode] "index" shares its chunk name with a plain chunk, so it would not be compiled.'
        )
      }
      console.log(
        `[main-only-bytecode] ${selectedNames.size} of ${chunks.length} chunks go to bytecode; the rest stay plain JS.`
      )
    }
  }

  return { chunkAlias: new SelectedChunkNames('(?!)'), plugin }
}
