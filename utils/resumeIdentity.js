/**
 * One account = one person's resume.
 *
 * The first name saved in an account's resume becomes that account's
 * locked "resume identity". After that, every save — Resume Builder,
 * uploads, Career Studio, restoring a version — keeps that name, so one
 * account cannot be used to build resumes for other people. The lock lives
 * on the User, so deleting the career profile does not reset it.
 *
 * Only spelling of the SAME name may change (capital letters, spacing,
 * dots): "srinivas sutar" → "Srinivas Sutar" is accepted.
 */
export const nameKey = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/[^a-z\u0900-\u097f\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Decide the name to store: the locked one, or the same name in better spelling. */
export function resolveLockedName(locked, incoming) {
  const l = String(locked || '').trim();
  const i = String(incoming || '').trim();
  if (!l) return { name: i, lock: Boolean(i), respelled: false };
  if (i && i !== l && nameKey(i) === nameKey(l)) return { name: i, lock: false, respelled: true };
  return { name: l, lock: false, respelled: false };
}

/** Same resume object with personal.name replaced (no mutation). */
export function withName(resume, name) {
  if (!resume || typeof resume !== 'object') return resume;
  if (resume.personal?.name === name) return resume;
  return { ...resume, personal: { ...(resume.personal || {}), name } };
}

/**
 * Applies the lock to a CareerProfile document before it is saved.
 * `UserModel` is passed in (not imported) so this can be tested without a
 * database. Returns { name, nameReset } — nameReset means a different
 * person's name was replaced by the locked one.
 */
export async function applyResumeIdentity(doc, UserModel) {
  const incoming = String(doc.master?.personal?.name || '').trim();
  if (!incoming) return { name: '', nameReset: false };
  const user = await UserModel.findById(doc.user).select('resumeIdentity').lean();
  const lockedBefore = user?.resumeIdentity?.name || '';
  const { name, lock, respelled } = resolveLockedName(lockedBefore, incoming);
  if (lock || respelled) {
    await UserModel.updateOne(
      { _id: doc.user },
      { $set: { 'resumeIdentity.name': name, ...(lock ? { 'resumeIdentity.lockedAt': new Date() } : {}) } }
    );
  }
  if (doc.master.personal.name !== name) doc.master = withName(doc.master, name);
  (doc.versions || []).forEach((v) => {
    if (v.resume?.personal && v.resume.personal.name !== name) v.resume = withName(v.resume, name);
  });
  return { name, nameReset: Boolean(lockedBefore) && !respelled && incoming !== name };
}
