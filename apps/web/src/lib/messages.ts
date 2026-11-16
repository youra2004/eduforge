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
