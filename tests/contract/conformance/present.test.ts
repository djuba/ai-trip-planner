import { it } from 'vitest';
import { targetUrl } from '../support/artifacts.ts';
import { checkPresentStream } from './checks/present.ts';

it('AC-CONTRACT-06: /present streams text/plain that ends as a valid PresentationModel', () =>
  checkPresentStream(targetUrl()));
