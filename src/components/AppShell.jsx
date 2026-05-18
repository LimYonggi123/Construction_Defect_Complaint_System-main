export default function AppShell({ children, variant = 'default' }) {
  return <div className={`app-shell app-shell-${variant}`}>{children}</div>;
}
