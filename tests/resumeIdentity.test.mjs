import test from 'node:test';
import assert from 'node:assert/strict';
import { applyResumeIdentity, resolveLockedName, nameKey } from '../utils/resumeIdentity.js';

/** One account = one person's resume. A fake User model stands in for MongoDB. */
function fakeUsers(locked = '') {
  const user = { resumeIdentity: locked ? { name: locked } : {} };
  const updates = [];
  return {
    user,
    updates,
    findById: () => ({ select: () => ({ lean: async () => user }) }),
    updateOne: async (q, u) => {
      updates.push(u.$set);
      if (u.$set['resumeIdentity.name']) user.resumeIdentity.name = u.$set['resumeIdentity.name'];
    },
  };
}
const doc = (name, versions = []) => ({ user: 'u1', master: { personal: { name, email: 'a@b.c' }, summary: 'x' }, versions });

test('the first saved name becomes the locked identity', async () => {
  const Users = fakeUsers();
  const d = doc('Srinivas Sutar');
  await applyResumeIdentity(d, Users);
  assert.equal(Users.user.resumeIdentity.name, 'Srinivas Sutar');
  assert.ok(Users.updates[0]['resumeIdentity.lockedAt'] instanceof Date);
});

test("another person's name is replaced by the locked name (master and versions)", async () => {
  const Users = fakeUsers('Srinivas Sutar');
  const d = doc('Shashikant S Bilgundi', [{ resume: { personal: { name: 'Someone Else' } } }]);
  const out = await applyResumeIdentity(d, Users);
  assert.equal(d.master.personal.name, 'Srinivas Sutar');
  assert.equal(d.versions[0].resume.personal.name, 'Srinivas Sutar');
  assert.equal(out.nameReset, true);
  assert.equal(d.master.summary, 'x', 'everything else stays as sent');
});

test('the same name with better capitals/spacing is accepted', async () => {
  const Users = fakeUsers('srinivas  sutar');
  const d = doc('Srinivas Sutar');
  const out = await applyResumeIdentity(d, Users);
  assert.equal(d.master.personal.name, 'Srinivas Sutar');
  assert.equal(Users.user.resumeIdentity.name, 'Srinivas Sutar');
  assert.equal(out.nameReset, false);
});

test('helpers', () => {
  assert.equal(nameKey('  Srinivas.  SUTAR '), 'srinivas sutar');
  assert.deepEqual(resolveLockedName('', 'A B'), { name: 'A B', lock: true, respelled: false });
  assert.equal(resolveLockedName('A B', 'C D').name, 'A B');
});
