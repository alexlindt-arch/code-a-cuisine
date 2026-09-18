/**
 * @file footer.spec.ts
 * @description Unit tests for the global footer.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Component } from '@angular/core';

import { Footer } from './footer';

/** Empty page used as routing target in the tests. */
@Component({ template: '' })
class EmptyPage {}

describe('Footer', () => {
  let fixture: ComponentFixture<Footer>;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Footer],
      providers: [provideRouter([
        { path: '', component: EmptyPage },
        { path: 'cookbook', component: EmptyPage, data: { headerStyle: 'light' } },
      ])],
    }).compileComponents();

    fixture = TestBed.createComponent(Footer);
    router = TestBed.inject(Router);
  });

  it('should hide the imprint link on the landing page', async () => {
    await router.navigateByUrl('/');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('a')).toBeNull();
  });

  it('should show the imprint link on other pages', async () => {
    await router.navigateByUrl('/cookbook');
    fixture.detectChanges();
    const link = (fixture.nativeElement as HTMLElement).querySelector('a');
    expect(link?.getAttribute('href')).toBe('/impress');
  });
});
