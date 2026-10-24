import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import SettingsGroups from './SettingsGroups';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    scroll: _scroll,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { scroll?: boolean }) => {
    void _scroll;
    return (
      <a
        {...props}
        href={href}
        onClick={(event) => {
          event.preventDefault();
          window.history.pushState(null, '', href);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }}
      />
    );
  },
}));

const panels = {
  profile: (
    <label>
      Profile draft
      <input defaultValue="Original" />
    </label>
  ),
  integrations: (
    <article id="oura">
      <h3>Oura connection</h3>
      <button>Reconnect</button>
    </article>
  ),
  people: (
    <details>
      <summary>Family management</summary>
      <div id="dependents">
        <h3>Dependents</h3>
        <label>
          Dependent name
          <input />
        </label>
      </div>
    </details>
  ),
  data: <div>Saved document reviews</div>,
  advanced: (
    <label>
      One-time token
      <input defaultValue="Synthetic token" />
    </label>
  ),
};

beforeEach(() => {
  window.history.replaceState(null, '', '/settings');
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

describe('grouped Settings navigation', () => {
  it('uses real, touch-sized navigation links and mounts only the initial group', () => {
    render(<SettingsGroups panels={panels} />);
    const navigation = screen.getByRole('navigation', { name: 'Settings sections' });
    const links = within(navigation).getAllByRole('link');
    expect(links).toHaveLength(5);
    expect(within(navigation).getByRole('link', { name: 'Profile' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    links.forEach((link) => expect(link).toHaveClass('min-h-11'));
    expect(screen.getByLabelText('Profile draft')).toBeInTheDocument();
    expect(screen.queryByText('Saved document reviews')).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('retains form drafts and one-time token reveals across groups and browser history', async () => {
    render(<SettingsGroups panels={panels} />);
    fireEvent.change(screen.getByLabelText('Profile draft'), { target: { value: 'Unsaved edit' } });
    fireEvent.click(screen.getByRole('link', { name: 'Advanced & about' }));
    expect(window.location.search).toBe('?tab=advanced');
    expect(screen.getByLabelText('One-time token')).toHaveValue('Synthetic token');
    expect(document.getElementById('settings-panel-profile')).toHaveAttribute('hidden');
    fireEvent.click(screen.getByRole('link', { name: 'Profile' }));
    expect(screen.getByLabelText('Profile draft')).toHaveValue('Unsaved edit');
    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Advanced & about' })).toHaveAttribute(
        'aria-current',
        'page'
      )
    );
    expect(screen.getByLabelText('One-time token')).toHaveValue('Synthetic token');
  });

  it('opens and focuses a legacy dependent link and responds to fragment changes', async () => {
    window.history.replaceState(null, '', '/settings#dependents');
    render(<SettingsGroups panels={panels} />);
    expect(screen.getByRole('link', { name: 'People & sharing' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(document.querySelector('details')).toHaveAttribute('open');
    expect(document.activeElement).toHaveTextContent('Dependents');
    act(() => {
      window.location.hash = 'oura';
    });
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Integrations' })).toHaveAttribute(
        'aria-current',
        'page'
      )
    );
    expect(document.activeElement).toHaveTextContent('Oura connection');
  });

  it('forces an old OAuth result to its source and waits for an asynchronous card', async () => {
    window.history.replaceState(null, '', '/settings?tab=profile&oura=error&reason=invalid_state');
    const view = render(
      <SettingsGroups panels={{ ...panels, integrations: <p>Loading source…</p> }} />
    );
    expect(screen.getByRole('link', { name: 'Integrations' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.queryByLabelText('Profile draft')).not.toBeInTheDocument();
    view.rerender(<SettingsGroups panels={panels} />);
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Oura connection'));
  });

  it('drops drafts on leaving Settings rather than persisting them in browser storage', () => {
    const firstVisit = render(<SettingsGroups panels={panels} />);
    fireEvent.change(screen.getByLabelText('Profile draft'), {
      target: { value: 'Temporary edit' },
    });
    firstVisit.unmount();
    render(<SettingsGroups panels={panels} />);
    expect(screen.getByLabelText('Profile draft')).toHaveValue('Original');
  });
});
