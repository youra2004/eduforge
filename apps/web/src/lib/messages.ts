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
  version_not_published: 'Нову версію можна створити лише з опублікованої.',
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
    'Репетитор недоступний під час тесту: завершіть тест або поверніться до нього пізніше.',
  tutor_rate_limited: 'Забагато запитів до репетитора. Зачекайте хвилину.',
  tutor_budget_exceeded: 'Денний ліміт підказок вичерпано. Спробуйте завтра.',
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
