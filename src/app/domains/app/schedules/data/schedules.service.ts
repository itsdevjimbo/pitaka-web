import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, throwError } from 'rxjs';
import { ApiError, API_BASE_URL } from '@/app/core/api';
import {
  NewSchedule,
  Schedule,
  ScheduleDirection,
  ScheduleFrequency,
  ScheduleStatus,
  ScheduleUpdate,
} from './schedule';
import { addCalendarDays, formatCalendarDate } from './schedule-calendar';

/** The API resource. Its recurring-transaction vocabulary ends at this adapter. */
type RecurringTransactionResource = {
  id: number;
  accountId: number;
  categoryId: number | null;
  name: string;
  type: 'Income' | 'Expense';
  amount: number;
  description: string | null;
  frequency: 'Daily' | 'Weekly' | 'Monthly' | 'Yearly';
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  status: 'Active' | 'Paused' | 'Completed' | 'Cancelled';
  generatedTransactionCount: number;
  canDelete: boolean;
};

const DIRECTION: Record<RecurringTransactionResource['type'], ScheduleDirection> = {
  Income: 'income',
  Expense: 'expense',
};
const FREQUENCY: Record<RecurringTransactionResource['frequency'], ScheduleFrequency> = {
  Daily: 'daily',
  Weekly: 'weekly',
  Monthly: 'monthly',
  Yearly: 'yearly',
};
const STATUS: Record<RecurringTransactionResource['status'], ScheduleStatus> = {
  Active: 'active',
  Paused: 'paused',
  Completed: 'completed',
  Cancelled: 'cancelled',
};
const API_DIRECTION: Record<ScheduleDirection, RecurringTransactionResource['type']> = {
  income: 'Income',
  expense: 'Expense',
};
const API_FREQUENCY: Record<ScheduleFrequency, RecurringTransactionResource['frequency']> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};
const API_FIELD_TO_PRODUCT_FIELD: Readonly<Record<string, string>> = {
  type: 'direction',
  startDate: 'firstGeneration',
  endDate: 'lastGeneration',
};
const DUPLICATE_NAME = /name.*already exists|already exists.*name/i;

/** Handwritten Schedule HTTP adapter (ADRs 0002 and 0003). */
@Injectable({ providedIn: 'root' })
export class SchedulesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** Every Schedule the signed-in person owns, read fresh for lifecycle management. */
  list(): Observable<Schedule[]> {
    return this.http
      .get<RecurringTransactionResource[]>(`${this.baseUrl}/api/recurring-transactions`)
      .pipe(map((resources) => resources.map(toSchedule)));
  }

  /** Create one Schedule, translating product vocabulary and calendar dates at the adapter. */
  create(schedule: NewSchedule): Observable<Schedule> {
    return this.http
      .post<RecurringTransactionResource>(`${this.baseUrl}/api/recurring-transactions`, {
        accountId: schedule.accountId,
        categoryId: schedule.categoryId,
        name: schedule.name,
        type: API_DIRECTION[schedule.direction],
        amount: schedule.amount,
        description: schedule.description,
        frequency: API_FREQUENCY[schedule.frequency],
        startDate: toDateOnly(schedule.firstGeneration),
        endDate: schedule.lastGeneration === null ? null : toDateOnly(schedule.lastGeneration),
      })
      .pipe(
        map(toSchedule),
        catchError((error: unknown) => throwError(() => toScheduleError(error, schedule))),
      );
  }

  /** Update only the details the API permits to change on an existing Schedule. */
  update(id: number, changes: ScheduleUpdate): Observable<Schedule> {
    return this.http
      .put<RecurringTransactionResource>(`${this.baseUrl}/api/recurring-transactions/${id}`, {
        name: changes.name,
        amount: changes.amount,
        categoryId: changes.categoryId,
        description: changes.description,
        endDate: changes.lastGeneration === null ? null : toDateOnly(changes.lastGeneration),
      })
      .pipe(
        map(toSchedule),
        catchError((error: unknown) => throwError(() => toScheduleError(error))),
      );
  }
}

function toSchedule(resource: RecurringTransactionResource): Schedule {
  return {
    id: resource.id,
    accountId: resource.accountId,
    categoryId: resource.categoryId,
    name: resource.name,
    direction: DIRECTION[resource.type],
    amount: resource.amount,
    description: resource.description,
    frequency: FREQUENCY[resource.frequency],
    firstGeneration: toCalendarDate(resource.startDate),
    lastGeneration: resource.endDate === null ? null : toCalendarDate(resource.endDate),
    nextGeneration: toCalendarDate(resource.nextRunDate),
    status: STATUS[resource.status],
    generatedTransactionCount: resource.generatedTransactionCount,
    canDelete: resource.canDelete,
  };
}

/** Parse an API DateOnly as the same local calendar day, never as a UTC instant. */
function toCalendarDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Assemble an API DateOnly from local calendar getters without a UTC conversion. */
function toDateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Keep API field names and recurring-transaction wording inside this adapter. */
function toScheduleError(error: unknown, schedule?: NewSchedule): unknown {
  if (!(error instanceof ApiError)) return error;

  if (error.status === 409 && DUPLICATE_NAME.test(error.message)) {
    const message = 'A Schedule with this name already exists.';
    return new ApiError(message, error.status, { name: [message] });
  }

  const fieldErrors: Record<string, readonly string[]> = {};
  for (const [field, messages] of Object.entries(error.fieldErrors)) {
    const productField = API_FIELD_TO_PRODUCT_FIELD[field] ?? field;
    fieldErrors[productField] = schedule ? scheduleFieldErrors(productField, messages, schedule) : messages;
  }
  return new ApiError(error.message, error.status, fieldErrors);
}

function scheduleFieldErrors(field: string, messages: readonly string[], schedule: NewSchedule): readonly string[] {
  if (messages.length === 0) return messages;
  if (field === 'firstGeneration') return [minimumMessage(firstGenerationMinimum())];
  if (field === 'lastGeneration') return [minimumMessage(addCalendarDays(schedule.firstGeneration, 1))];
  return messages;
}

/** Tomorrow in the UTC calendar, represented as the same local calendar day. */
function firstGenerationMinimum(now = new Date()): Date {
  return new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

function minimumMessage(minimum: Date): string {
  return `Choose ${formatCalendarDate(minimum)} or later`;
}
