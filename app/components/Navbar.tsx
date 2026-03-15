'use client';

import { useState } from 'react';
import Link from 'next/link';

export type NavPage = 'dashboard' | 'history' | 'analytics' | 'tracker';

const LINKS: { href: string; label: string; key: NavPage }[] = [
  { href: '/',          label: 'Dashboard', key: 'dashboard' },
  { href: '/history',   label: 'History',   key: 'history'   },
  { href: '/analytics', label: 'Analytics', key: 'analytics' },
  { href: '/tracker',   label: 'Tracker',   key: 'tracker'   },
];

interface NavbarProps {
  active: NavPage;
  /** Desktop: rendered inline next to nav links.
   *  Mobile: rendered inside the hamburger dropdown. */
  actions?: React.ReactNode;
}

export function Navbar({ active, actions }: NavbarProps) {
  const [open, setOpen] = useState(false);

  return (
    <nav
      style={{
        background: 'rgba(5,5,14,0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--border-subtle)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      {/* ── Main bar ── */}
      <div
        style={{ maxWidth: '1536px', margin: '0 auto', padding: '0 1rem' }}
        className="h-14 flex items-center gap-3"
      >
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2.5 shrink-0"
          style={{ textDecoration: 'none', marginRight: '4px' }}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
            style={{ background: 'linear-gradient(135deg,#2563eb,#7c3aed)' }}
          >
            ⚡
          </div>
          <span
            className="font-bold text-sm tracking-tight gradient-text-blue"
            style={{ display: 'none' }}
            id="nav-brand"
          >
            AlgoBot
          </span>
          <style>{`@media(min-width:480px){#nav-brand{display:block}}`}</style>
        </Link>

        {/* Desktop nav links */}
        <div className="hidden-mobile nav-links-desktop flex items-center gap-0.5 flex-1">
          <style>{`.nav-links-desktop{display:none}@media(min-width:768px){.nav-links-desktop{display:flex}}`}</style>
          {LINKS.map(l => (
            <Link
              key={l.key}
              href={l.href}
              className={`nav-link${active === l.key ? ' active' : ''}`}
            >
              {l.label}
            </Link>
          ))}
        </div>

        {/* Spacer pushes actions + hamburger to right on mobile */}
        <div className="flex-1" style={{}} />

        {/* Desktop actions */}
        <div className="nav-actions-desktop flex items-center gap-2">
          <style>{`.nav-actions-desktop{display:none}@media(min-width:768px){.nav-actions-desktop{display:flex}}`}</style>
          {actions}
        </div>

        {/* Mobile hamburger button */}
        <button
          onClick={() => setOpen(v => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="nav-hamburger"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            border: `1px solid ${open ? 'rgba(59,130,246,0.4)' : 'var(--border-subtle)'}`,
            background: open ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.04)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '18px',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          <style>{`@media(min-width:768px){.nav-hamburger{display:none!important}}`}</style>
          {open ? '✕' : '☰'}
        </button>
      </div>

      {/* ── Mobile dropdown ── */}
      {open && (
        <div
          className="nav-mobile-drawer"
          style={{
            borderTop: '1px solid var(--border-subtle)',
            background: 'rgba(5,5,14,0.98)',
          }}
        >
          <style>{`@media(min-width:768px){.nav-mobile-drawer{display:none!important}}`}</style>

          {/* Nav links */}
          <div style={{ padding: '12px 16px 8px' }}>
            {LINKS.map(l => (
              <Link
                key={l.key}
                href={l.href}
                onClick={() => setOpen(false)}
                className={`nav-link${active === l.key ? ' active' : ''}`}
                style={{ display: 'block', padding: '10px 12px', marginBottom: '2px', fontSize: '0.875rem' }}
              >
                {l.label}
              </Link>
            ))}
          </div>

          {/* Page-specific actions */}
          {actions && (
            <div
              style={{
                padding: '8px 16px 14px',
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {actions}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
