/** The short questionnaire after each module (RESEARCH.md §2): 1 = strongly disagree … 5 = strongly agree. */
export const SURVEY_ITEMS = [
  { key: 'clarity', text: 'Матеріал модуля був зрозумілим.' },
  { key: 'help', text: 'Навчання в цьому модулі допомогло мені добре розібратися в темі.' },
  { key: 'effort', text: 'Навчання в цьому модулі вимагало від мене великих розумових зусиль.' },
  {
    key: 'frustration',
    text: 'Під час навчання в цьому модулі я часто відчував(-ла) роздратування.',
  },
] as const;

export const LIKERT_MIN = 1;
export const LIKERT_MAX = 5;
export const LIKERT_LABELS = [
  'Зовсім не згоден',
  'Скоріше не згоден',
  'Важко сказати',
  'Скоріше згоден',
  'Повністю згоден',
] as const;
