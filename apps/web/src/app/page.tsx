import Link from 'next/link';
import { Icon, type IconName } from '@/components/icons';
import { HeroGraph } from '@/components/HeroGraph';
import { Mascot } from '@/components/Mascot';
import { getCurrentUser } from '@/lib/server';

const pillars: { icon: IconName; tone: string; title: string; text: string }[] = [
  {
    icon: 'network',
    tone: 'sun',
    title: 'Граф замість списку уроків',
    text: 'Наступний вузол відкривається, коли ви підтвердили розуміння попередніх. Видно, що пройдено, що відкрито, а що ще чекає.',
  },
  {
    icon: 'message',
    tone: 'pink',
    title: 'Репетитор, який підказує',
    text: 'Допомагає навідними питаннями й схожими прикладами на основі пройденого матеріалу, але не видає готових відповідей.',
  },
  {
    icon: 'shield-check',
    tone: 'sky',
    title: 'Іспит і сертифікат, що перевіряється',
    text: 'Підсумковий іспит проходить під наглядом, а сертифікат має цифровий підпис: його може перевірити будь-хто за посиланням.',
  },
];

const tones = ['violet', 'sun', 'pink', 'mint', 'sky', 'violet'] as const;

const steps = [
  { icon: 'book', title: 'Запишіться на курс' },
  { icon: 'network', title: 'Проходьте вузли графа' },
  { icon: 'check', title: 'Підтверджуйте тестами' },
  { icon: 'shield-check', title: 'Складіть іспит' },
  { icon: 'award', title: 'Отримайте сертифікат' },
] as const;

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
        <header className="page-head welcome">
          <Mascot mood="cheer" size={104} float follow />
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
            .map((s, i) => (
              <Link
                key={s.href}
                href={s.href}
                className="card link shortcut"
                data-tone={tones[i % tones.length]}
              >
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
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="dot" aria-hidden />
            Навчання без нудьги
          </span>
          <h1>
            EduForge веде вас по <span className="marker">графу знань</span>
          </h1>
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
        <div className="hero-art">
          <HeroGraph />
          <div className="hero-mascot">
            <span className="bubble">Ще крок — і «Цикли» відкриті!</span>
            <Mascot mood="happy" size={132} float follow />
          </div>
          <span className="sticker s1" aria-hidden>
            <Icon name="check" size={14} /> +1 вузол
          </span>
          <span className="sticker s2" aria-hidden>
            80 % навичок
          </span>
        </div>
      </section>
      <section className="pillars" aria-label="Як це працює">
        {pillars.map((p, i) => (
          <div key={p.title} className="pillar" data-tone={p.tone}>
            <span className="pillar-no" aria-hidden>
              0{i + 1}
            </span>
            <span className="pillar-icon">
              <Icon name={p.icon} size={22} />
            </span>
            <h3>{p.title}</h3>
            <p>{p.text}</p>
          </div>
        ))}
      </section>
      <section className="path" aria-label="Шлях студента">
        <ol>
          {steps.map((s) => (
            <li key={s.title}>
              <span className="path-node">
                <Icon name={s.icon} size={20} />
              </span>
              <span>{s.title}</span>
            </li>
          ))}
        </ol>
      </section>
      <section className="cta-band">
        <Mascot mood="cheer" size={120} float />
        <div>
          <h2>Готові розблокувати перший вузол?</h2>
          <p>Реєстрація безкоштовна. Граф відкриється одразу після запису на курс.</p>
        </div>
        <Link href="/register" className="btn lg">
          Почати навчання
        </Link>
      </section>
    </div>
  );
}
