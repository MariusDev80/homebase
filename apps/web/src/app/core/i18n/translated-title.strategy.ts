import { Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject, combineLatest, map, switchMap } from 'rxjs';

/** The route `title` is an i18n key; the window title becomes "Homebase — <page>". */
@Injectable({ providedIn: 'root' })
export class TranslatedTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly transloco = inject(TranslocoService);
  private readonly key$ = new BehaviorSubject<string | undefined>(undefined);

  constructor() {
    super();
    this.key$
      .pipe(
        switchMap((key) => {
          const appName$ = this.transloco.selectTranslate('app.name');
          return key
            ? combineLatest([appName$, this.transloco.selectTranslate(key)])
            : appName$.pipe(map((name) => [name]));
        }),
        takeUntilDestroyed(),
      )
      .subscribe((parts) => this.title.setTitle(parts.join(' — ')));
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.key$.next(this.buildTitle(snapshot));
  }
}
