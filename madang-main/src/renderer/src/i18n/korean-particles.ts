const HANGUL_START = 0xac00
const HANGUL_END = 0xd7a3
const JONGSEONG_COUNT = 28
const JONGSEONG_RIEUL = 8

// Pairs the catalog writes as "받침 있을 때(없을 때)"; the word before them decides which one is right.
const PARTICLE_PAIR = /([가-힣])(을\(를\)|은\(는\)|이\(가\)|과\(와\)|으로\(로\))/g

function jongseong(syllable: string): number {
  const code = syllable.charCodeAt(0)
  return code >= HANGUL_START && code <= HANGUL_END ? (code - HANGUL_START) % JONGSEONG_COUNT : 0
}

function pickParticle(pair: string, syllable: string): string {
  const final = jongseong(syllable)
  const hasFinal = final !== 0
  switch (pair) {
    case '을(를)':
      return hasFinal ? '을' : '를'
    case '은(는)':
      return hasFinal ? '은' : '는'
    case '이(가)':
      return hasFinal ? '이' : '가'
    case '과(와)':
      return hasFinal ? '과' : '와'
    default:
      // 으로(로): ㄹ받침은 "로"를 쓴다.
      return hasFinal && final !== JONGSEONG_RIEUL ? '으로' : '로'
  }
}

/**
 * Picks the particle that fits the Hangul word before it: "작업을(를)" → "작업을", "에이전트을(를)" → "에이전트를".
 * A pair after a Latin letter or digit stays as written, because its spoken ending is not known here.
 */
export function resolveKoreanParticles(text: string): string {
  return text.replace(PARTICLE_PAIR, (_match, syllable: string, pair: string) => {
    return `${syllable}${pickParticle(pair, syllable)}`
  })
}
