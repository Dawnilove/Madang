import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '../../i18n/i18n'
import { getDiscardEntryConfirmationCopy } from './source-control/commit/discard-confirmation'

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('discard descriptions with real locale catalogs', () => {
  it.each([
    [
      'en',
      'This will revert the unstaged changes to this file. This cannot be undone.',
      'This will restore the last staged version and discard the deletion. This cannot be undone.'
    ],
    [
      'es',
      'Esto revertirá los cambios no preparados de este archivo. No se puede deshacer.',
      'Esto restaurará la última versión preparada y descartará la eliminación. No se puede deshacer.'
    ],
    [
      'fr',
      'Cela annulera les modifications non planifiées apportées à ce fichier. Cela ne peut pas être annulé.',
      'Cela restaurera la dernière version intermédiaire et annulera la suppression. Cela ne peut pas être annulé.'
    ],
    [
      'ja',
      'これにより、このファイルに対するステージングされていない変更が元に戻ります。これを元に戻すことはできません。',
      'これにより、最後にステージングされたバージョンが復元され、削除が破棄されます。これを元に戻すことはできません。'
    ],
    [
      'ko',
      '이 파일의 스테이징하지 않은 변경을 되돌립니다. 되돌릴 수 없습니다.',
      '마지막으로 스테이징한 버전을 복원하고 삭제를 취소합니다. 되돌릴 수 없습니다.'
    ],
    [
      'zh',
      '这将恢复对此文件的未暂存更改。此操作无法撤消。',
      '这将恢复最后一个暂存版本并放弃删除。此操作无法撤消。'
    ]
  ] as const)(
    'uses current index-preserving descriptions in %s',
    async (locale, modifiedDescription, deletedDescription) => {
      await i18n.changeLanguage(locale)
      expect(
        getDiscardEntryConfirmationCopy({
          area: 'unstaged',
          path: 'changed.txt',
          status: 'modified'
        }).description
      ).toBe(modifiedDescription)
      expect(
        getDiscardEntryConfirmationCopy({
          area: 'unstaged',
          path: 'removed.txt',
          status: 'deleted'
        }).description
      ).toBe(deletedDescription)
    }
  )
})
