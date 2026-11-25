import { expect, it } from 'vitest';

import { buildConfigurationSavePayload, isRiskCategory, readClassifiedEntities, withoutAdminKeys } from './configModel.js';

it.each(['Risk', 'High risk', 'Sanction', 'sanctioned', 'PEP', 'SIM_BOX', 'simbox', 'Blacklist', 'watch-list', 'Fraudster', 'suspicious', 'Terrorism', 'Money laundering', 'scam', 'mule', 'crime', 'Criminal'])('%s is a risk', (category) => {
  expect(isRiskCategory(category)).toBe(true);
});
it.each(['Trusted', 'Low risk', 'no_risk', 'Payroll', 'Government', '', null, 'Pepper Ltd', 'Crimson'])('%s is not', (category) => {
  expect(isRiskCategory(category)).toBe(false);
});

it('a risk category is saved in the risk list, never passed through; reason and text entries are kept (R2-8)', () => {
  const saved = buildConfigurationSavePayload({
    trusted_entities: [
      { key: 'ACCOUNT', value: '1', category: 'Sanction', pass_through: true, reason: 'UN list' },
      { key: 'ACCOUNT', value: '2', category: 'Payroll', pass_through: true, reason: 'salary' },
      '0911223344',
    ],
    risk_entities: [{ key: 'ACCOUNT', value: '3', category: 'PEP' }],
  });
  expect(saved.risk_entities).toEqual([
    { key: 'ACCOUNT', value: '1', category: 'Sanction', pass_through: false, reason: 'UN list' },
    { key: 'ACCOUNT', value: '3', category: 'PEP', pass_through: false },
  ]);
  expect(saved.trusted_entities).toEqual([
    { key: 'ACCOUNT', value: '2', category: 'Payroll', pass_through: true, reason: 'salary' },
    { key: 'CALLING_NO', value: '0911223344', category: 'Trusted', pass_through: false },
  ]);
  expect(readClassifiedEntities({ trusted_entities: ['0911'] })).toEqual([expect.objectContaining({ key: 'CALLING_NO', value: '0911' })]);
});

it('what only an administrator may save is left out for others (R2-18)', () => {
  expect(withoutAdminKeys({ kafka_topics: ['t'], active_tool_password: 'x', active_tool_password_ref: 'r', tool_credentials: {}, trusted_entities: [], risk_entities: [], api_token: 'x' })).toEqual({ kafka_topics: ['t'] });
});
