// Illustrations used when a product has no photo yet (the owner uploads real photos from the admin panel).
const THEMES = {
  'whole-spices': ['#F7B91F', '#9A5E08', '#FFF0BF'],
  'ground-spices': ['#DE4430', '#842419', '#FDE1DC'],
  'masala-blends': ['#E8A00C', '#A02619', '#FFE08A'],
  'dry-fruits': ['#B38F72', '#5C4033', '#F1E9E0'],
};
export function ProductArt({ slug = '', name = '' }) {
  const [a, b, c] = THEMES[slug] || ['#E8A00C', '#7A490C', '#FFF0BF'];
  const initial = (name.trim()[0] || 'M').toUpperCase();
  return (
    <svg viewBox="0 0 200 200" role="img" aria-label={name || 'Product'} className="art" preserveAspectRatio="xMidYMid slice">
      <rect width="200" height="200" fill={c} />
      <circle cx="100" cy="92" r="70" fill="#fff" opacity=".35" />
      <path d="M30 118h140c0 34-26 58-70 58s-70-24-70-58z" fill={b} />
      <path d="M44 118c10-36 32-52 56-52s46 16 56 52z" fill={a} />
      <circle cx="78" cy="96" r="6" fill={c} opacity=".7" /><circle cx="108" cy="86" r="5" fill={c} opacity=".7" /><circle cx="128" cy="104" r="6" fill={c} opacity=".7" />
      <text x="100" y="158" textAnchor="middle" fontFamily="Fraunces, Georgia, serif" fontSize="30" fontWeight="700" fill={c}>{initial}</text>
    </svg>
  );
}

export function Mandala({ className = '' }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.2">
        {[90, 74, 58, 42, 26].map((r) => <circle key={r} cx="100" cy="100" r={r} strokeDasharray={r > 60 ? '2 5' : undefined} />)}
        {Array.from({ length: 16 }).map((_, i) => (
          <ellipse key={i} cx="100" cy="46" rx="9" ry="22" transform={`rotate(${i * 22.5} 100 100)`} />
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <ellipse key={'s' + i} cx="100" cy="72" rx="5" ry="12" transform={`rotate(${i * 45 + 22.5} 100 100)`} />
        ))}
      </g>
    </svg>
  );
}

export function Logo({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="23" fill="#842419" />
      <circle cx="24" cy="24" r="19" fill="none" stroke="#F7B91F" strokeWidth="1.2" strokeDasharray="1.5 3" />
      <path d="M12 31h24c0 6-5 10-12 10s-12-4-12-10z" fill="#F7B91F" />
      <path d="M15 31c2-8 5-12 9-12s7 4 9 12z" fill="#E8A00C" />
      <path d="M24 9c3 3 4 6 2 10-3-2-4-6-2-10z" fill="#DE4430" />
    </svg>
  );
}

const icon = (d, extra) => ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}{extra}</svg>
);
export const IconCart = icon(<><path d="M3 4h2.5l2.2 11h10.1l2-8H6.2" /></>, <><circle cx="9" cy="19.5" r="1.4" /><circle cx="17" cy="19.5" r="1.4" /></>);
export const IconHome = icon(<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />);
export const IconShop = icon(<path d="M4 8h16l-1.2 11a1 1 0 0 1-1 .9H6.2a1 1 0 0 1-1-.9z" />, <path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8" />);
export const IconTrack = icon(<><path d="M3 7h11v9H3z" /><path d="M14 10h4l3 3v3h-7" /></>, <><circle cx="7" cy="17.5" r="1.6" /><circle cx="17" cy="17.5" r="1.6" /></>);
export const IconSearch = icon(<circle cx="11" cy="11" r="6.5" />, <path d="M16 16l4.5 4.5" />);
export const IconPhone = icon(<path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2z" />);
export const IconPin = icon(<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.800 12 21 12 21z" />, <circle cx="12" cy="9.5" r="2.5" />);
export const IconCheck = icon(<path d="M5 12.5l4.5 4.5L19 7.500" />);
export const IconWhatsApp = icon(<path d="M4 20l1.3-4.2A8 8 0 1 1 8.300 18.800z" />, <path d="M9 9.500c0 3 2.500 5.500 5.500 5.500l1-1.500-2-1-1 .8a4 4 0 0 1-1.800-1.800l.8-1-1-2z" />);
export const IconTrash = icon(<><path d="M4 7h16" /><path d="M9 7V4.500h6V7" /><path d="M6.500 7l.8 12.500h9.400L17.500 7" /></>);
export const IconMenu = icon(<path d="M4 7h16M4 12h16M4 17h16" />);
