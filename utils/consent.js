import mongoose from 'mongoose';
import { z } from 'zod';
import { ApiError } from './ApiError.js';

/**
 * Consent to process personal data (Digital Personal Data Protection Act, 2023).
 *
 * Every public form that collects personal data or a resume must send
 * `consent: true`. The server enforces it (a checkbox alone can be
 * bypassed by calling the API directly) and stores a record of what was
 * agreed, which version of the wording, when, and from where — DPDP puts
 * the burden of proving consent on the Data Fiduciary.
 *
 * If the wording changes, bump CONSENT_VERSION and update the frontend
 * copy in src/data/legal.js to match. Old records keep their version.
 */
export const CONSENT_VERSION = '2026-09-28';

export const CONSENT_TEXT =
  'I agree to the Terms & Conditions and Privacy Policy, and consent to DutyLaunch processing my personal data and resume for career and recruitment facilitation services.';

export const CONSENT_REQUIRED_MESSAGE =
  'Please agree to the Terms & Conditions and Privacy Policy to continue.';

/** JSON bodies send `true`; multipart forms send the string "true". */
export const isConsentGiven = (value) => value === true || value === 'true';

/** Zod field for JSON and multipart schemas alike. */
export const consentField = z.any().refine(isConsentGiven, { message: CONSENT_REQUIRED_MESSAGE }).transform(() => true);

/** What gets stored with the submission. */
export function consentRecord(req) {
  return {
    given: true,
    version: CONSENT_VERSION,
    text: CONSENT_TEXT,
    at: new Date(),
    ip: req.ip,
    userAgent: String(req.get?.('user-agent') || '').slice(0, 300),
  };
}

/** For upload routes that have no Zod schema. Place after multer. */
export function requireConsent(req, _res, next) {
  if (!isConsentGiven(req.body?.consent)) {
    return next(ApiError.badRequest(CONSENT_REQUIRED_MESSAGE, [{ field: 'consent', message: CONSENT_REQUIRED_MESSAGE }]));
  }
  return next();
}

/** Embedded in every model that holds a consented submission. */
export const consentRecordSchema = new mongoose.Schema(
  {
    given: { type: Boolean, default: false },
    version: String,
    text: String,
    at: Date,
    ip: String,
    userAgent: String,
  },
  { _id: false }
);
