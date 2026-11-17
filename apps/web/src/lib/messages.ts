import type { AuthErrorCode, CourseErrorCode } from '@eduforge/core';
import type { Role, VersionStatus } from '@eduforge/db';

export const errorMessages: Record<AuthErrorCode | CourseErrorCode | 'internal', string> = {
  unauthenticated: 'Потрібно увійти в систему.',
  forbidden: 'Недостатньо прав для цієї дії.',
  invalid_input:
    'Перевірте введені дані: пароль — щонайменше 8 символів, потрібна згода з умовами.',
  invalid_credentials: 'Невірний email або пароль.',
  rate_limited: 'Забагато невдалих спроб входу. Спробуйте пізніше.',
  email_taken: 'Користувач з таким email уже існує.',
  not_found: 'Не знайдено.',
  last_admin: 'Не можна забрати роль в останнього адміністратора.',
  invalid_course: 'Курс містить помилки. Перегляньте список проблем.',
  slug_taken: 'Курс з таким slug уже існує.',
  version_locked: 'Цю версію курсу не можна змінювати. Створіть нову версію.',
  version_not_published:
    'Нову версію можна створити лише з опублікованої (або з тієї, де вичерпано аудити).',
  course_not_found: 'Курс не знайдено.',
  invalid_content: 'Матеріал містить помилки. Перегляньте список проблем.',
  content_not_found: 'Матеріал не знайдено.',
  media_not_found: 'Відео не знайдено.',
  question_not_found: 'Питання не знайдено.',
  invalid_question: 'Питання містить помилки. Перегляньте список проблем.',
  wrong_pool: 'Питання з іншого пулу не можна використати тут.',
  not_enrolled: 'Спочатку запишіться на курс.',
  node_locked: 'Цей вузол ще закритий: пройдіть усі попередні вузли.',
  node_cooldown: 'Триває пауза після невдалих спроб. Спробуйте пізніше.',
  node_passed: 'Цей вузол уже пройдено.',
  test_unavailable: 'Тест цього вузла ще не готовий: у банку замало перевірених питань.',
  assessment_not_found: 'Тест не знайдено.',
  assessment_closed: 'Цей тест уже завершено.',
  already_answered: 'На це питання вже відповіли.',
  invalid_tutor_input: 'Повідомлення має містити від 1 до 1000 символів.',
  tutor_unavailable:
    'Репетитор недоступний, поки триває тест (на цьому або іншому вузлі). Завершіть розпочатий тест.',
  tutor_rate_limited: 'Забагато запитів до репетитора. Зачекайте хвилину.',
  tutor_budget_exceeded: 'Денний ліміт підказок вичерпано. Спробуйте завтра.',
  tutor_disabled: 'У цьому модулі репетитор не передбачений.',
  node_test_disabled: 'У цьому модулі тести вузлів не передбачені: навчайтеся у власному порядку.',
  experiment_not_joined: 'Спершу погодьтеся на участь у дослідженні.',
  experiment_step_not_allowed:
    'Цей крок зараз недоступний. Дотримуйтесь порядку на сторінці дослідження.',
  experiment_course_missing: 'Курс цього модуля ще не опубліковано.',
  consent_required: 'Для участі потрібна інформована згода.',
  invalid_survey: 'Відповідьте на всі запитання анкети.',
  audit_limit_reached:
    'Ліміт аудитів для цієї версії вичерпано. Створіть нову версію курсу (копію цієї).',
  invalid_version_state: 'Ця дія недоступна в поточному стані версії курсу.',
  invalid_graph_edit: 'Не вдалося змінити граф. Перегляньте список проблем.',
  review_not_found: 'Перевірку не знайдено.',
  invalid_review: 'Рішення експерта заповнено неповно. Перегляньте список проблем.',
  review_conflict: 'Цю перевірку вже призначено або розглянуто.',
  exam_not_eligible: 'Іспит відкриється, коли ви пройдете всі вузли курсу.',
  exam_banned: 'Вам тимчасово закрито доступ до іспитів. Навчання залишається доступним.',
  exam_cooldown: 'Спроби цього раунду вичерпано. Новий раунд почнеться після паузи.',
  exam_passed: 'Іспит із цього курсу вже складено.',
  exam_time_expired: 'Час на це питання вичерпано. Відповідь не прийнято.',
  exam_not_current: 'Відповісти можна лише на поточне питання.',
  internal: 'Щось пішло не так. Спробуйте ще раз.',
};

export const roleLabels: Record<Role, string> = {
  student: 'Студент',
  author: 'Автор',
  expert: 'Експерт',
  admin: 'Адміністратор',
};

// Where each role lands; also drives the navigation.
export const rolePages: Record<Role, string> = {
  student: '/student',
  author: '/author',
  expert: '/expert',
  admin: '/admin',
};

export const versionStatusLabels: Record<VersionStatus, string> = {
  draft: 'Чернетка',
  auditing: 'На аудиті',
  changes_requested: 'Потрібні зміни',
  ready_to_publish: 'Готово до публікації',
  expert_review: 'Експертна перевірка',
  published: 'Опубліковано',
  archived: 'В архіві',
};

export const nodeStateLabels = {
  locked: 'Заблокований',
  available: 'Доступний',
  in_progress: 'У процесі',
  passed: 'Пройдено',
  cooldown: 'Пауза',
} as const;

export const levelLabels: Record<string, string> = {
  junior: 'Junior (початковий)',
  middle: 'Middle (впевнена практика)',
  senior: 'Senior (складні програми)',
  expert: 'Expert (рівень творця технології)',
};

/** What the student sees next to the rating: the band the rating belongs to (D-07). */
export function ratingBand(rating: number) {
  return rating <= 3 ? 'junior' : rating <= 6 ? 'middle' : rating <= 9 ? 'senior' : 'expert';
}

export const failedStageLabels: Record<string, string> = {
  structure: 'Курс не пройшов перевірку структури',
  conformity: 'Матеріали не відповідають опису курсу',
  skills: 'Деякі заявлені навички не покриті матеріалами',
  technical:
    'Аудит не вдалося завершити через технічну помилку. Запуск повернуто, спробуйте ще раз',
};

export const feedbackLabels = {
  theoryDepth: 'Глибина теорії',
  questionTrickiness: 'Складність питань',
  edgeCases: 'Покриття крайніх випадків',
} as const;

export const checklistLabels = {
  theory_accuracy: 'Теорія точна і не містить помилок',
  expert_depth: 'Глибина відповідає рівню експерта',
  questions_quality: 'Питання якісні та недвозначні',
  skills_coverage: 'Усі заявлені навички справді розкриті',
  edge_cases: 'Розглянуто складні та крайні випадки',
} as const;

export const reviewStatusLabels = {
  assigned: 'Призначено експерта',
  approved: 'Схвалено',
  rejected: 'Відхилено',
} as const;

export function notificationText(type: string, p: Record<string, unknown>): string {
  const title = String(p.title ?? '');
  switch (type) {
    case 'audit_finished':
      return p.outcome === 'ready_to_publish'
        ? `Аудит курсу «${title}» завершено: рейтинг ${p.rating}. Курс готовий до публікації.`
        : `Аудит курсу «${title}» завершено: потрібні зміни.`;
    case 'audit_failed':
      return `Аудит курсу «${title}» не вдалося завершити. Запуск повернуто — спробуйте ще раз.`;
    case 'expert_review_started':
      return `Курс «${title}» — кандидат на найвищий рейтинг (10). Він на експертній перевірці.`;
    case 'review_assigned':
      return `Вам призначено перевірку курсу «${title}».`;
    case 'review_decided':
      return p.decision === 'approved'
        ? `Експерт схвалив курс «${title}»: рейтинг 10. Курс готовий до публікації.`
        : `Експерт відхилив рейтинг 10 для курсу «${title}». Перегляньте чек-лист і оберіть, що робити далі.`;
    default:
      return type;
  }
}

export const examSkillLevelLabels = {
  perfect: 'Опановано досконало',
  good: 'Добре',
  needs_work: 'Потребує доопрацювання',
} as const;
