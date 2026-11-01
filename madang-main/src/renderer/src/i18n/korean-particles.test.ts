import { describe, expect, it } from 'vitest'
import { resolveKoreanParticles } from './korean-particles'

describe('resolveKoreanParticles', () => {
  it('picks the particle by the final consonant of the Hangul word before it', () => {
    expect(resolveKoreanParticles('작업을(를) 삭제합니다')).toBe('작업을 삭제합니다')
    expect(resolveKoreanParticles('에이전트을(를) 시작합니다')).toBe('에이전트를 시작합니다')
    expect(resolveKoreanParticles('프로젝트은(는)')).toBe('프로젝트는')
    expect(resolveKoreanParticles('작업은(는)')).toBe('작업은')
    expect(resolveKoreanParticles('브랜치이(가)')).toBe('브랜치가')
    expect(resolveKoreanParticles('작업이(가)')).toBe('작업이')
    expect(resolveKoreanParticles('코드과(와)')).toBe('코드와')
    expect(resolveKoreanParticles('파일과(와)')).toBe('파일과')
  })

  it('uses 로 after a vowel or ㄹ and 으로 after other consonants', () => {
    expect(resolveKoreanParticles('에이전트으로(로)')).toBe('에이전트로')
    expect(resolveKoreanParticles('파일으로(로)')).toBe('파일로')
    expect(resolveKoreanParticles('작업으로(로)')).toBe('작업으로')
  })

  it('changes every pair in a sentence', () => {
    expect(
      resolveKoreanParticles('작업을(를) 프로젝트으로(로) 옮깁니다. 에이전트이(가) 끝났습니다')
    ).toBe('작업을 프로젝트로 옮깁니다. 에이전트가 끝났습니다')
  })

  it('leaves a pair after a Latin letter, digit, space or nothing as written', () => {
    expect(resolveKoreanParticles('Bash을(를) 실행')).toBe('Bash을(를) 실행')
    expect(resolveKoreanParticles('3을(를)')).toBe('3을(를)')
    expect(resolveKoreanParticles(' 을(를)')).toBe(' 을(를)')
    expect(resolveKoreanParticles('을(를)')).toBe('을(를)')
  })

  it('does not touch text without a pair', () => {
    expect(resolveKoreanParticles('작업을 삭제합니다')).toBe('작업을 삭제합니다')
    expect(resolveKoreanParticles('')).toBe('')
  })
})
