import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const Ctx = createContext({ path: '/', search: '', navigate: () => {} });
const read = () => ({ path: window.location.pathname.replace(/\/+$/, '') || '/', search: window.location.search });

export function Router({ children }) {
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const on = () => setLoc(read());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const navigate = useCallback((to, { replace = false } = {}) => {
    if (replace) window.history.replaceState(null, '', to); else window.history.pushState(null, '', to);
    setLoc(read());
    if (!replace) window.scrollTo(0, 0);
  }, []);
  return <Ctx.Provider value={{ ...loc, navigate }}>{children}</Ctx.Provider>;
}
export const useRouter = () => useContext(Ctx);
export const useQuery = () => { const { search } = useRouter(); return new URLSearchParams(search); };

export function Link({ to, children, className, onClick, ...rest }) {
  const { navigate } = useRouter();
  return (
    <a href={to} className={className} {...rest} onClick={(e) => {
      if (onClick) onClick(e);
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || rest.target === '_blank') return;
      e.preventDefault(); navigate(to);
    }}>{children}</a>
  );
}
