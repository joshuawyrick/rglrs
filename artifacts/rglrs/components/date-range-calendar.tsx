"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import styles from "./date-range-calendar.module.css";

function isoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function parseIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function DateRangeCalendar({
  startDate,
  endDate,
  onChange,
}: {
  startDate: string;
  endDate: string;
  onChange: (startDate: string, endDate: string) => void;
}) {
  const initial = parseIso(startDate) || new Date();
  const [month, setMonth] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1));
  const start = parseIso(startDate);
  const end = parseIso(endDate);
  const today = new Date();
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const gridStart = new Date(first);
    gridStart.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      return date;
    });
  }, [month]);

  function choose(date: Date) {
    const value = isoDate(date);
    if (!startDate || endDate) {
      onChange(value, "");
      return;
    }
    if (value < startDate) {
      onChange(value, startDate);
      return;
    }
    onChange(startDate, value);
  }

  const summary = start
    ? end
      ? `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
      : `${start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · choose an end date`
    : "Choose a start date";

  return <div className={styles.calendar}>
    <div className={styles.header}>
      <button type="button" className={styles.nav} aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={18}/></button>
      <div className={styles.month}>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>
      <button type="button" className={styles.nav} aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={18}/></button>
    </div>
    <div className={styles.weekdays}>{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((day) => <div className={styles.weekday} key={day}>{day}</div>)}</div>
    <div className={styles.grid}>
      {days.map((date) => {
        const value = isoDate(date);
        const isSelected = value === startDate || value === endDate;
        const isInRange = Boolean(startDate && endDate && value > startDate && value < endDate);
        const className = [styles.day, date.getMonth() !== month.getMonth() ? styles.muted : "", isSelected ? styles.selected : "", isInRange ? styles.inRange : "", sameDay(date, today) ? styles.today : ""].filter(Boolean).join(" ");
        return <button type="button" key={value} className={className} aria-pressed={isSelected} onClick={() => choose(date)}>{date.getDate()}</button>;
      })}
    </div>
    <div className={styles.rangeSummary}>{summary}</div>
    <p className={styles.hint}>Tap once for the start date, then tap the end date. Tap a new date after a completed range to start over.</p>
  </div>;
}
