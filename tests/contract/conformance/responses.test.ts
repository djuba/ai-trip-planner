import { it } from 'vitest';
import { targetUrl } from '../support/artifacts.ts';
import {
  checkExtractResponse,
  checkExtractRouting,
  checkRecommendResponse,
} from './checks/responses.ts';

it('AC-CONTRACT-05: /extract with a valid request returns a valid ExtractResponse', () =>
  checkExtractResponse(targetUrl()));

it('AC-CONTRACT-05: /recommend with a valid request returns a valid RecommendResponse', () =>
  checkRecommendResponse(targetUrl()));

it('AC-CONTRACT-12: /extract routes a vague message to needs_clarification and a confirmed profile to ready', () =>
  checkExtractRouting(targetUrl()));
