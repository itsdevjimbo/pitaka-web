import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS, provideNativeDateAdapter } from '@angular/material/core';
import { of, Subject } from 'rxjs';
import { provideIcons } from '@/app/core/icons';
import { Goal } from '../../data/goal';
import { GoalsService } from '../../data/goals.service';
import { GoalForm } from './goal-form';

const GOAL: Goal = {
  id: 3,
  name: 'Dental work',
  targetAmount: 30000,
  targetDate: null,
  status: 'Active',
  currentAmount: 1200,
};

describe('GoalForm', () => {
  function setup(create: GoalsService['create'] = () => of(GOAL)): ComponentFixture<GoalForm> {
    TestBed.configureTestingModule({
      imports: [GoalForm],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: GoalsService, useValue: { create } },
      ],
    });

    const fixture = TestBed.createComponent(GoalForm);
    fixture.detectChanges();
    return fixture;
  }

  function enter(fixture: ComponentFixture<GoalForm>, selector: string, value: string): void {
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(selector);
    if (!input) {
      throw new Error(`Expected ${selector}`);
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('keeps invalid submission available, reveals validation, and focuses the first invalid field without saving', async () => {
    const create = vi.fn();
    const fixture = setup(create as unknown as GoalsService['create']);
    const element = fixture.nativeElement as HTMLElement;
    const form = element.querySelector('form');
    const submit = Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Create goal',
    );
    if (!form || !submit) {
      throw new Error('Expected the Goal form and submit button');
    }

    expect(submit.disabled).toBe(false);
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('You must enter a name');
    expect(create).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(element.querySelector('#goal-name'));
  });

  it('releases a timed-out save and tells the person to refresh instead of retrying the write', async () => {
    const inFlight = new Subject<Goal>();
    const create = vi.fn(() => inFlight.asObservable());
    const fixture = setup(create as unknown as GoalsService['create']);
    const pending: boolean[] = [];
    fixture.componentInstance.pendingChange.subscribe((value) => pending.push(value));
    enter(fixture, '#goal-name', 'Dental work');
    enter(fixture, '#goal-target-amount', '30000');

    vi.useFakeTimers();
    try {
      (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await Promise.resolve();
      expect(pending).toEqual([true]);

      await vi.advanceTimersByTimeAsync(15_000);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('couldn’t confirm whether this Goal was saved');
      expect(pending).toEqual([true, false]);
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
