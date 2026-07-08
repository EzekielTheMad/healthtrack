'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export type AutocompleteResult = {
  display: string;
  code: string;
} & Record<string, unknown>;

interface MedicalAutocompleteProps {
  label: string;
  value: string;
  code: string | null;
  onChange: (value: string, code: string | null, result?: AutocompleteResult) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  searchFn: (query: string, signal?: AbortSignal) => Promise<Array<{ display: string; code: string } & Record<string, any>>>;
  placeholder?: string;
  required?: boolean;
  error?: string;
  id?: string;
}

export function MedicalAutocomplete({
  label,
  value,
  code,
  onChange,
  searchFn,
  placeholder = 'Start typing to search...',
  required = false,
  error,
  id,
}: MedicalAutocompleteProps) {
  const [inputValue, setInputValue] = useState(value);
  const [results, setResults] = useState<AutocompleteResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [searched, setSearched] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listboxId = id ? `${id}-listbox` : 'medical-autocomplete-listbox';

  // Sync external value changes
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const performSearch = useCallback(
    async (query: string) => {
      if (query.length < 2) {
        setResults([]);
        setIsOpen(false);
        setSearched(false);
        return;
      }

      // Cancel previous request
      if (abortRef.current) {
        abortRef.current.abort();
      }

      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setSearched(false);

      try {
        const data = await searchFn(query, controller.signal);
        if (!controller.signal.aborted) {
          setResults(data);
          setIsOpen(true);
          setHighlightIndex(-1);
          setSearched(true);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // Ignore abort errors
        } else {
          if (!controller.signal.aborted) {
            setResults([]);
            setSearched(true);
            setLoading(false);
          }
        }
      }
    },
    [searchFn],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange(newValue, null);

    // Debounce search
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      performSearch(newValue);
    }, 300);
  };

  const handleSelect = (result: AutocompleteResult) => {
    setInputValue(result.display);
    onChange(result.display, result.code, result);
    setIsOpen(false);
    setResults([]);
    setHighlightIndex(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || results.length === 0) {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < results.length) {
          handleSelect(results[highlightIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setHighlightIndex(-1);
        break;
    }
  };

  const activeDescendant =
    highlightIndex >= 0 ? `${listboxId}-option-${highlightIndex}` : undefined;

  return (
    <div ref={containerRef} className="relative">
      <label
        htmlFor={id}
        className="block text-sm font-medium mb-1"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {label}
        {required && <span style={{ color: 'var(--color-terracotta)' }}> *</span>}
      </label>

      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          required={required}
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={activeDescendant}
          className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-card)',
            color: 'var(--color-text-primary)',
          }}
        />

        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div
              className="w-4 h-4 border-2 rounded-full animate-spin"
              style={{
                borderColor: 'var(--border-card)',
                borderTopColor: 'var(--color-text-muted)',
              }}
            />
          </div>
        )}
      </div>

      {error && (
        <p className="mt-1 text-xs" style={{ color: 'var(--color-terracotta)' }}>
          {error}
        </p>
      )}

      {code && (
        <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Code: {code}
        </p>
      )}

      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 w-full mt-1 rounded-xl overflow-y-auto"
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            maxHeight: '15rem',
          }}
        >
          {loading && results.length === 0 && (
            <li className="px-3 py-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 border-2 rounded-full animate-spin"
                  style={{
                    borderColor: 'var(--border-card)',
                    borderTopColor: 'var(--color-text-muted)',
                  }}
                />
                Searching...
              </div>
            </li>
          )}

          {!loading && searched && results.length === 0 && (
            <li className="px-3 py-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              No results found
            </li>
          )}

          {results.map((result, index) => (
            <li
              key={`${result.code}-${index}`}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === highlightIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(result);
              }}
              onMouseEnter={() => setHighlightIndex(index)}
              className="px-3 py-2 cursor-pointer transition-colors"
              style={{
                backgroundColor: index === highlightIndex ? 'var(--border-card)' : 'transparent',
              }}
              onMouseOver={(e) => {
                if (index !== highlightIndex) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-primary)';
                }
              }}
              onMouseOut={(e) => {
                if (index !== highlightIndex) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                }
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {result.display}
                </span>
                <span
                  className="text-xs flex-shrink-0"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {result.code}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
