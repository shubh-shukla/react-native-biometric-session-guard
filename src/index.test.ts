import { PACKAGE_NAME } from './index.js';

describe('package entry', () => {
  it('exposes the package name', () => {
    expect(PACKAGE_NAME).toBe('react-native-biometric-session-guard');
  });
});
