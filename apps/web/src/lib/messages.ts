import type { AuthErrorCode } from '@eduforge/core';
import type { Role } from '@eduforge/db';

export const errorMessages: Record<AuthErrorCode | 'internal', string> = {
  unauthenticated: 'Потрібно увійти в систему.',
  forbidden: 'Недостатньо прав для цієї дії.',
  invalid_input:
    'Перевірте введені дані: пароль — щонайменше 8 символів, потрібна згода з умовами.',
  invalid_credentials: 'Невірний email або пароль.',
  rate_limited: 'Забагато невдалих спроб входу. Спробуйте пізніше.',
  email_taken: 'Користувач з таким email уже існує.',
  not_found: 'Не знайдено.',
  last_admin: 'Не можна забрати роль в останнього адміністратора.',
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
