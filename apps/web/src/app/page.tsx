import Link from 'next/link';
import { Icon, type IconName } from '@/components/icons';
import { HeroGraph } from '@/components/HeroGraph';
import { getCurrentUser } from '@/lib/server';

const pillars: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'network',
    title: 'Граф замість списку уроків',
    text: 'Наступний вузол відкривається, коли ви підтвердили розуміння попередніх. Видно, що пройдено, що відкрито, а що ще чекає.',
  },
  {
    icon: 'message',
    title: 'Репетитор, який підказує',
    text: 'Допомагає навідними питаннями й схожими прикладами на основі пройденого матеріалу, але не видає готових відповідей.',
  },
  {
    icon: 'shield-check',
    title: 'Іспит і сертифікат, що перевіряється',
    text: 'Підсумковий іспит проходить під наглядом, а сертифікат має цифровий підпис: його може перевірити будь-хто за посиланням.',
  },
];

const shortcuts = [
  { href: '/courses', icon: 'book', title: 'Каталог курсів', text: 'Оберіть курс і запишіться' },
  {
    href: '/student',
    icon: 'cap',
    title: 'Мій прогрес',
    text: 'Курси, поради та сертифікати',
    role: 'student',
  },
  {
    href: '/author',
    icon: 'pen',
    title: 'Мої курси',
    text: 'Редактор графа, матеріали, аудит',
    role: 'author',
  },
  {
    href: '/expert',
    icon: 'eye',
    title: 'Експертна перевірка',
    text: 'Курси, призначені вам',
    role: 'expert',
  },
  {
    href: '/admin',
    icon: 'sliders',
    title: 'Користувачі й ролі',
    text: 'Черги, сертифікати, експорт',
    role: 'admin',
  },
  {
    href: '/experiment',
    icon: 'flask',
    title: 'Дослідження',
    text: 'Участь у магістерському дослідженні',
  },
] as const;

export default async function Home() {
  const user = await getCurrentUser();

  if (user) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1>EduForge</h1>
            <p className="lead">
              Вітаємо, {user.displayName}!{' '}
              {user.roles.length === 0
                ? 'Вам ще не призначено жодної ролі — зверніться до адміністратора.'
                : 'Оберіть, з чого почати.'}
            </p>
          </div>
        </header>
        <div className="grid">
          {shortcuts
            .filter((s) => !('role' in s) || user.roles.includes(s.role))
            .map((s) => (
              <Link key={s.href} href={s.href} className="card link shortcut">
                <span className="go" aria-hidden>
                  <Icon name="arrow-right" size={16} />
                </span>
                <span className="pillar-icon">
                  <Icon name={s.icon} size={18} />
                </span>
                <strong>{s.title}</strong>
                <span>{s.text}</span>
              </Link>
            ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="hero">
        <div>
          <h1>EduForge веде вас по графу знань</h1>
          <p className="lead">
            Кожен новий вузол відкривається, коли ви справді розумієте попередній. Репетитор
            підказує, іспит підтверджує, а сертифікат можна перевірити.
          </p>
          <div className="hero-actions">
            <Link href="/register" className="btn lg">
              Почати навчання
            </Link>
            <Link href="/login" className="btn lg secondary">
              Увійти
            </Link>
          </div>
        </div>
        <HeroGraph />
      </section>
      <section className="pillars" aria-label="Як це працює">
        {pillars.map((p) => (
          <div key={p.title} className="pillar">
            <span className="pillar-icon">
              <Icon name={p.icon} size={18} />
            </span>
            <h3>{p.title}</h3>
            <p>{p.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
