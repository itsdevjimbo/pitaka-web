import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { ScheduleLifecycleNav } from './schedule-lifecycle-nav';

describe('ScheduleLifecycleNav', () => {
  function setup(): ComponentFixture<ScheduleLifecycleNav> {
    TestBed.configureTestingModule({
      imports: [ScheduleLifecycleNav],
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    });
    const fixture = TestBed.createComponent(ScheduleLifecycleNav);
    fixture.componentRef.setInput('counts', { upcoming: 2, paused: 1, past: 3 });
    fixture.componentRef.setInput('view', 'upcoming');
    fixture.detectChanges();
    return fixture;
  }

  it('shows lifecycle choices without count badges and marks the selected view', () => {
    const element = setup().nativeElement as HTMLElement;
    const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>('button'));

    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Upcoming', 'Paused', 'Past']);
    expect(element.querySelector('.mat-badge-content')).toBeNull();
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('publishes a lifecycle selection', () => {
    const fixture = setup();

    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button');
    buttons[1].click();

    expect(fixture.componentInstance.view()).toBe('paused');
  });
});
