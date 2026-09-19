import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { API_BASE_URL } from '@/app/core/api';
import { Schedule, ScheduleDirection, ScheduleFrequency, ScheduleStatus } from './schedule';

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

/** Handwritten Schedule HTTP adapter (ADRs 0002 and 0003). */
@Injectable({ providedIn: 'root' })
export class SchedulesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** Every Schedule the signed-in person owns, read fresh for lifecycle management. */
  list(): Observable<Schedule[]> {
    return this.http
      .get<RecurringTransactionResource[]>(`${this.baseUrl}/api/recurringtransactions`)
      .pipe(map((resources) => resources.map(toSchedule)));
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
