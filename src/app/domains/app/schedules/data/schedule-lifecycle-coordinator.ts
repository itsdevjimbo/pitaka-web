import { inject, Injectable } from '@angular/core';
import { Observable, shareReplay, Subject, timeout, TimeoutError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { Schedule } from './schedule';
import { SCHEDULE_WRITE_TIMEOUT_MS } from './schedule-write';
import { SchedulesService } from './schedules.service';

export type ScheduleLifecycleEvent =
  | { kind: 'started'; scheduleId: number }
  | { kind: 'updated'; schedule: Schedule }
  | { kind: 'conflict'; scheduleId: number; message: string }
  | { kind: 'uncertain'; scheduleId: number; message: string }
  | { kind: 'failed'; scheduleId: number; message: string };

export type ScheduleLifecycleFailure = Pick<
  Extract<ScheduleLifecycleEvent, { kind: 'conflict' | 'uncertain' | 'failed' }>,
  'kind' | 'message'
>;

export function toScheduleLifecycleFailure(error: unknown): ScheduleLifecycleFailure {
  return {
    kind:
      error instanceof TimeoutError
        ? 'uncertain'
        : error instanceof ApiError && error.status === 409
          ? 'conflict'
          : 'failed',
    message:
      error instanceof TimeoutError
        ? 'We couldn’t confirm whether this Schedule changed. Refresh Schedules before trying again.'
        : error instanceof ApiError
          ? error.message
          : 'Something went wrong. Please try again.',
  };
}

/** Keeps lifecycle writes observable after their confirmation dialog is dismissed. */
@Injectable({ providedIn: 'root' })
export class ScheduleLifecycleCoordinator {
  private readonly schedulesService = inject(SchedulesService);
  private readonly eventSubject = new Subject<ScheduleLifecycleEvent>();
  readonly events = this.eventSubject.asObservable();

  setStatus(scheduleId: number, status: 'active' | 'paused'): Observable<Schedule> {
    return this.track(scheduleId, this.schedulesService.setStatus(scheduleId, status));
  }

  extend(scheduleId: number, lastGeneration: Date | null): Observable<Schedule> {
    return this.track(scheduleId, this.schedulesService.extend(scheduleId, lastGeneration));
  }

  private track(scheduleId: number, source: Observable<Schedule>): Observable<Schedule> {
    const request = source.pipe(
      timeout({ first: SCHEDULE_WRITE_TIMEOUT_MS }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    this.eventSubject.next({ kind: 'started', scheduleId });
    request.subscribe({
      next: (schedule) => this.eventSubject.next({ kind: 'updated', schedule }),
      error: (error: unknown) => {
        this.eventSubject.next({
          scheduleId,
          ...toScheduleLifecycleFailure(error),
        });
      },
    });
    return request;
  }
}
