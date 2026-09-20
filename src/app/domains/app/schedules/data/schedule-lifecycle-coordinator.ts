import { inject, Injectable } from '@angular/core';
import { Observable, shareReplay, Subject } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { Schedule } from './schedule';
import { SchedulesService } from './schedules.service';

export type ScheduleLifecycleEvent =
  | { kind: 'started'; scheduleId: number }
  | { kind: 'updated'; schedule: Schedule }
  | { kind: 'conflict'; scheduleId: number; message: string }
  | { kind: 'failed'; scheduleId: number; message: string };

/** Keeps lifecycle writes observable after their confirmation dialog is dismissed. */
@Injectable({ providedIn: 'root' })
export class ScheduleLifecycleCoordinator {
  private readonly schedulesService = inject(SchedulesService);
  private readonly eventSubject = new Subject<ScheduleLifecycleEvent>();
  readonly events = this.eventSubject.asObservable();

  setStatus(scheduleId: number, status: 'active' | 'paused'): Observable<Schedule> {
    const request = this.schedulesService
      .setStatus(scheduleId, status)
      .pipe(shareReplay({ bufferSize: 1, refCount: false }));

    this.eventSubject.next({ kind: 'started', scheduleId });
    request.subscribe({
      next: (schedule) => this.eventSubject.next({ kind: 'updated', schedule }),
      error: (error: unknown) => {
        const message = error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
        this.eventSubject.next({
          kind: error instanceof ApiError && error.status === 409 ? 'conflict' : 'failed',
          scheduleId,
          message,
        });
      },
    });
    return request;
  }
}
