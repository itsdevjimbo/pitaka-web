import { formatDate } from '@angular/common';
import { Schedule, ScheduleFrequency } from './schedule';

/** Add whole calendar days without treating a date-only value as an instant. */
export function addCalendarDays(value: Date, count: number): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + count);
}

/** Compare local date-only values without their time-of-day components. */
export function compareCalendarDates(left: Date, right: Date): number {
  return (
    Date.UTC(left.getFullYear(), left.getMonth(), left.getDate()) -
    Date.UTC(right.getFullYear(), right.getMonth(), right.getDate())
  );
}

export function formatCalendarDate(value: Date): string {
  return formatDate(value, 'd MMM y', 'en-US');
}

/**
 * The occurrence an edit must preserve to avoid completing a Schedule.
 * Active Schedules may still generate their stored overdue occurrence. Paused
 * Schedules skip missed occurrences when resumed, so their next eligible date
 * is recalculated from the original Frequency anchor and today's UTC calendar.
 */
export function nextEligibleGeneration(schedule: Schedule, now = new Date()): Date {
  if (schedule.status === 'active') return schedule.nextGeneration;

  const today = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const occurrences = Math.max(numberOfOccurrences(schedule.firstGeneration, today, schedule.frequency), 0);
  const candidate = addOccurrences(schedule.firstGeneration, schedule.frequency, occurrences);
  return compareCalendarDates(candidate, today) < 0
    ? addOccurrences(schedule.firstGeneration, schedule.frequency, occurrences + 1)
    : candidate;
}

function numberOfOccurrences(start: Date, end: Date, frequency: ScheduleFrequency): number {
  return FREQUENCY_STRATEGY[frequency].count(start, end);
}

function addOccurrences(start: Date, frequency: ScheduleFrequency, count: number): Date {
  return FREQUENCY_STRATEGY[frequency].add(start, count);
}

type FrequencyStrategy = {
  count: (start: Date, end: Date) => number;
  add: (start: Date, count: number) => Date;
};

const FREQUENCY_STRATEGY: Record<ScheduleFrequency, FrequencyStrategy> = {
  daily: {
    count: (start, end) => dayNumber(end) - dayNumber(start),
    add: addCalendarDays,
  },
  weekly: {
    count: (start, end) => Math.floor((dayNumber(end) - dayNumber(start)) / 7),
    add: (start, count) => addCalendarDays(start, count * 7),
  },
  monthly: {
    count: (start, end) => {
      const months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
      return end.getDate() < start.getDate() ? months - 1 : months;
    },
    add: addMonthsClamped,
  },
  yearly: {
    count: (start, end) => {
      const years = end.getFullYear() - start.getFullYear();
      if (end.getMonth() !== start.getMonth()) return end.getMonth() < start.getMonth() ? years - 1 : years;
      return end.getDate() < start.getDate() ? years - 1 : years;
    },
    add: addYearsClamped,
  },
};

function addMonthsClamped(start: Date, count: number): Date {
  const target = new Date(start.getFullYear(), start.getMonth() + count, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(start.getDate(), lastDay));
}

function addYearsClamped(start: Date, count: number): Date {
  const year = start.getFullYear() + count;
  const lastDay = new Date(year, start.getMonth() + 1, 0).getDate();
  return new Date(year, start.getMonth(), Math.min(start.getDate(), lastDay));
}

function dayNumber(value: Date): number {
  return Math.floor(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000);
}
