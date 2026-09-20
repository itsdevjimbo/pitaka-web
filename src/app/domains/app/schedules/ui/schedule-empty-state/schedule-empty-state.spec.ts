import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIcons } from '@/app/core/icons';
import { ScheduleEmptyState } from './schedule-empty-state';

describe('ScheduleEmptyState', () => {
  function setup(scope: 'all' | 'upcoming' | 'paused' | 'past'): ComponentFixture<ScheduleEmptyState> {
    TestBed.configureTestingModule({ imports: [ScheduleEmptyState], providers: [provideIcons()] });
    const fixture = TestBed.createComponent(ScheduleEmptyState);
    fixture.componentRef.setInput('scope', scope);
    fixture.detectChanges();
    return fixture;
  }

  it('offers creation when the complete collection is empty', () => {
    const fixture = setup('all');
    const created = vi.fn();
    fixture.componentInstance.create.subscribe(created);

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('No Schedules yet');
    element.querySelector<HTMLButtonElement>('button')!.click();
    expect(created).toHaveBeenCalledOnce();
  });

  it.each([
    ['upcoming', 'No upcoming Schedules'],
    ['paused', 'No paused Schedules'],
    ['past', 'No past Schedules'],
  ] as const)('shows the %s lifecycle message without a create action', (scope, message) => {
    const element = setup(scope).nativeElement as HTMLElement;

    expect(element.textContent).toContain(message);
    expect(element.querySelector('button')).toBeNull();
  });
});
