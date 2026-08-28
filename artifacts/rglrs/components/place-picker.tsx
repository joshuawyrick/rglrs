"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MapPin } from "lucide-react";

export type PlaceValue = {
  name: string;
  address: string;
};

type PlaceSuggestion = PlaceValue & {
  id: string;
  label: string;
};

export function PlacePicker({
  id,
  value,
  onChange,
  placeholder = "Search for a place or address",
  autoFocus = false,
}: {
  id?: string;
  value: PlaceValue;
  onChange: (value: PlaceValue) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const generatedId = useId();
  const inputId = id || `place-${generatedId.replace(/:/g, "")}`;
  const listId = `${inputId}-suggestions`;
  const [query, setQuery] = useState(value.name);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const sessionToken = useRef<string | null>(null);

  useEffect(() => {
    setQuery(value.name);
  }, [value.name]);

  useEffect(() => {
    const input = query.trim();
    if (input.length < 3 || (input === value.name.trim() && Boolean(value.address))) {
      setSuggestions([]);
      setLoading(false);
      setError(null);
      setActiveIndex(-1);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (!sessionToken.current) sessionToken.current = crypto.randomUUID();
      setLoading(true);
      setError(null);
      void fetch("/places/autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, sessionToken: sessionToken.current }),
        signal: controller.signal,
      }).then(async (response) => {
        const payload = await response.json().catch(() => null) as { suggestions?: PlaceSuggestion[]; error?: string } | null;
        if (!response.ok) throw new Error(payload?.error || "Could not search for places.");
        setSuggestions(payload?.suggestions || []);
        setActiveIndex(-1);
      }).catch((searchError) => {
        if (controller.signal.aborted) return;
        setSuggestions([]);
        setError(searchError instanceof Error ? searchError.message : "Could not search for places.");
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, value.address, value.name]);

  const select = (suggestion: PlaceSuggestion) => {
    setQuery(suggestion.name);
    setSuggestions([]);
    setActiveIndex(-1);
    setError(null);
    sessionToken.current = null;
    onChange({ name: suggestion.name, address: suggestion.address });
  };

  return (
    <div className="place-picker">
      <div className="search-box">
        <MapPin size={17} color="var(--muted)" />
        <input
          id={inputId}
          className="input"
          autoFocus={autoFocus}
          autoComplete="off"
          maxLength={160}
          placeholder={placeholder}
          value={query}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={suggestions.length > 0}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            setActiveIndex(-1);
            onChange({ name: next, address: "" });
          }}
          onKeyDown={(event) => {
            if (!suggestions.length) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter" && activeIndex >= 0) {
              event.preventDefault();
              select(suggestions[activeIndex]);
            } else if (event.key === "Escape") {
              setSuggestions([]);
              setActiveIndex(-1);
            }
          }}
        />
      </div>
      {value.address ? <div className="place-picker-selected-address">{value.address}</div> : null}
      {loading ? <div className="place-picker-status" role="status">Finding places…</div> : null}
      {!loading && error ? <div className="place-picker-status error-message" role="alert">{error} You can still enter a location manually.</div> : null}
      {!loading && !error && query.trim().length >= 3 && !suggestions.length && !value.address
        ? <div className="place-picker-status">No suggestions yet. Keep typing or use your own label.</div>
        : null}
      {suggestions.length ? (
        <div className="place-suggestions" id={listId} role="listbox">
          {suggestions.map((suggestion, index) => (
            <button
              id={`${listId}-${index}`}
              key={suggestion.id}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              className={`place-suggestion ${activeIndex === index ? "active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => select(suggestion)}
            >
              <MapPin size={15} />
              <span>
                <strong>{suggestion.name}</strong>
                {suggestion.address ? <small>{suggestion.address}</small> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}