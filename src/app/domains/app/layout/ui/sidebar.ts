import { Component } from '@angular/core';
import { Navigation } from '@/app/domains/app/layout/ui/navigation';
import { User } from '@/app/domains/app/layout/ui/user';

@Component({
  selector: 'app-sidebar',
  imports: [Navigation, User],
  host: {
    class: 'flex w-full flex-auto flex-col',
  },
  template: `
    <!-- Header -->
    <div class="relative flex items-center gap-x-2.5 pt-5 pr-4 pb-0 pl-6 text-primary-600 dark:text-primary-200">
      <!-- Logo -->
      <img
        src="/images/logo/logo.svg"
        class="size-8 dark:hidden"
        alt=""
      />
      <img
        src="/images/logo/logo-on-dark.svg"
        class="hidden size-8 dark:block"
        alt=""
      />

      <div class="font-display text-2xl leading-none">Pitaka</div>
    </div>

    <!-- Navigation -->
    <navigation class="mt-8 mb-4 flex-auto" />

    <!-- Spacer -->
    <div class="flex-auto"></div>

    <!-- Footer -->
    <div class="p-2">
      <user />
    </div>
  `,
})
export class AppSidebar {}
