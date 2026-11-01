import { translate } from '@/i18n/i18n'

/** Explains where a report goes when Madang saves it locally instead of uploading it. */
export function LocalFeedbackNote(): React.JSX.Element {
  return (
    <div className="text-xs text-muted-foreground">
      {translate(
        'madang.feedback.localNote',
        'Send saves this report on this PC and opens a prefilled GitHub issue. Drag any screenshots from the opened folder into the issue.'
      )}
    </div>
  )
}
