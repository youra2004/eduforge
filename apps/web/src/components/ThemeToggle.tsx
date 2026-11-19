'use client';

import { Icon } from './icons';

/** Light/dark switch. The icon is chosen by CSS from <html data-theme>, so server and client markup match. */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const dark = root.dataset.theme !== 'dark';
    if (dark) root.dataset.theme = 'dark';
    else delete root.dataset.theme;
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      // storage can be blocked; the choice then lasts until the page is closed
    }
  }
  return (
    <button
      type="button"
      className="secondary theme-toggle"
      onClick={toggle}
      aria-label="Змінити тему: світла або темна"
      title="Світла / темна тема"
    >
      <span className="moon">
        <Icon name="moon" size={16} />
      </span>
      <span className="sun">
        <Icon name="sun" size={16} />
      </span>
    </button>
  );
}
