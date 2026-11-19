/** A short burst of confetti on a screen that celebrates a pass. Pure CSS; hidden for reduced motion. */
const colors = ['#4b3cf0', '#8b7dff', '#0f7b55', '#f0b24a', '#ff7a70', '#3ecf9a'];

export function Confetti() {
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: 28 }, (_, i) => (
        <i
          key={i}
          style={
            {
              '--x': `${(i * 37) % 100}%`,
              '--c': colors[i % colors.length],
              '--d': `${(i % 7) * 70}ms`,
              '--dx': `${((i * 53) % 90) - 45}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
