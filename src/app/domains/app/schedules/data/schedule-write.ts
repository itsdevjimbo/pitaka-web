import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/** Shared boundary after which a Schedule write has an uncertain outcome. */
export const SCHEDULE_WRITE_TIMEOUT_MS = 15_000;

/** Propagates an editor's uncertain write outcome to the owning Schedule screen. */
@Injectable({ providedIn: 'root' })
export class ScheduleWriteFreshness {
  private readonly uncertainSubject = new Subject<void>();
  readonly uncertain = this.uncertainSubject.asObservable();

  reportUncertain(): void {
    this.uncertainSubject.next();
  }
}
