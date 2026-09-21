import { DatePipe } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { PesoPipe } from '@/app/core/money';
import { GoalContributionWithAccountName } from '../../data/contributions/contribution-account-name';

/** One readable entry in a Goal's complete Contribution history. */
@Component({
  selector: 'li[goals-contribution-history-row]',
  templateUrl: './contribution-history-row.html',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatMenuModule, PesoPipe],
})
export class ContributionHistoryRow {
  readonly contribution = input.required<GoalContributionWithAccountName>();
  readonly pending = input(false);
  readonly edit = output<GoalContributionWithAccountName>();
  readonly delete = output<GoalContributionWithAccountName>();
}
