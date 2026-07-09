/**
 * CategorySection — collapsible registry-category wrapper on the vitals page.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CategorySection from './CategorySection';

describe('CategorySection', () => {
  it('renders title, metric count and children (expanded by default)', () => {
    render(
      <CategorySection title="Sleep" count={3}>
        <p>section body</p>
      </CategorySection>,
    );
    expect(screen.getByRole('heading', { name: 'Sleep' })).toBeInTheDocument();
    expect(screen.getByText('3 metrics')).toBeInTheDocument();
    expect(screen.getByText('section body')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('uses singular "metric" for a single-metric category', () => {
    render(
      <CategorySection title="Metabolic" count={1}>
        <p>body</p>
      </CategorySection>,
    );
    expect(screen.getByText('1 metric')).toBeInTheDocument();
  });

  it('collapses and re-expands on header click', () => {
    render(
      <CategorySection title="Recovery" count={2}>
        <p>section body</p>
      </CategorySection>,
    );
    const toggle = screen.getByRole('button');

    fireEvent.click(toggle);
    expect(screen.queryByText('section body')).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(screen.getByText('section body')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});
